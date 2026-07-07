"""tetrapod infra: one big pet (tetrapod) + one tiny watcher (lighthouse).

Hard rule: nothing here may ever touch Bedrock or Bedrock-related IAM.
The only IAM created is the SSM break-glass role and the DLM snapshot role.
"""

import json

import pulumi
import pulumi_aws as aws

cfg = pulumi.Config()

INSTANCE_TYPE = cfg.get("instanceType") or "t4g.xlarge"
LIGHTHOUSE_TYPE = cfg.get("lighthouseType") or "t4g.micro"
ROOT_GB = cfg.get_int("rootVolumeGb") or 100
SSH_PUBLIC_KEY = cfg.require("sshPublicKey")
TS_AUTH_KEY = cfg.require_secret("tailscaleAuthKey")  # reusable + pre-approved key
BUDGET_EMAIL = cfg.get("budgetEmail")
BUDGET_LIMIT = cfg.get("budgetLimit") or "150"
# break-glass only; tailscale-ssh is the real door. flip with:
#   pulumi config set tetrapod:enablePublicSsh true && pulumi up
ENABLE_PUBLIC_SSH = cfg.get_bool("enablePublicSsh") or False

# ubuntu 24.04 LTS arm64, always-current AMI via canonical's SSM parameter
ami_id = aws.ssm.get_parameter(
    name="/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id"
).value

default_vpc = aws.ec2.get_vpc(default=True)

# ------------------------------------------------------------------ network

ingress = [
    # tailscale direct wireguard path (avoids DERP relaying). harmless: it's
    # wireguard, unauthenticated packets are dropped.
    aws.ec2.SecurityGroupIngressArgs(
        protocol="udp", from_port=41641, to_port=41641, cidr_blocks=["0.0.0.0/0"],
        description="tailscale wireguard",
    ),
]
if ENABLE_PUBLIC_SSH:
    ingress.append(
        aws.ec2.SecurityGroupIngressArgs(
            protocol="tcp", from_port=22, to_port=22, cidr_blocks=["0.0.0.0/0"],
            description="break-glass ssh (key auth only)",
        )
    )

sg = aws.ec2.SecurityGroup(
    "tailnet-only",
    vpc_id=default_vpc.id,
    description="tetrapod: tailscale-only ingress",
    ingress=ingress,
    egress=[aws.ec2.SecurityGroupEgressArgs(
        protocol="-1", from_port=0, to_port=0, cidr_blocks=["0.0.0.0/0"],
    )],
    tags={"Project": "tetrapod"},
)

key_pair = aws.ec2.KeyPair("tetrapod", public_key=SSH_PUBLIC_KEY)

# ------------------------------------------------------- ssm break-glass iam

ssm_role = aws.iam.Role(
    "tetrapod-ssm",
    assume_role_policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "ec2.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    }),
    tags={"Project": "tetrapod"},
)
aws.iam.RolePolicyAttachment(
    "tetrapod-ssm-core",
    role=ssm_role.name,
    policy_arn="arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
)
instance_profile = aws.iam.InstanceProfile("tetrapod-ssm", role=ssm_role.name)

# ------------------------------------------------------------- cloud-init


def user_data(hostname: str, extra: str = "") -> pulumi.Output[str]:
    """Minimal first boot: get on the tailnet, have docker. Everything else
    is provision/bootstrap.sh (tetrapod) or `extra` (lighthouse)."""
    return TS_AUTH_KEY.apply(lambda key: f"""#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl git
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey '{key}' --ssh --hostname {hostname}
curl -fsSL https://get.docker.com | sh
# the login user is tetraslam, not ubuntu (rename keeps uid 1000, one home)
usermod -l tetraslam -d /home/tetraslam -m ubuntu
groupmod -n tetraslam ubuntu
sed -i 's/\\bubuntu\\b/tetraslam/g' /etc/sudoers.d/90-cloud-init-users
usermod -aG docker tetraslam
{extra}
""")


LIGHTHOUSE_EXTRA = """
# uptime-kuma, fully set up by cloud-init: watches tetrapod from outside.
mkdir -p /opt/kuma
# --dns: containers don't inherit magicdns, so hand kuma the tailscale
# resolver directly or tailnet hostnames won't resolve in monitors
docker run -d --name uptime-kuma --restart unless-stopped \\
  --dns 100.100.100.100 --dns-search tailc27667.ts.net \\
  --log-opt max-size=20m --log-opt max-file=3 \\
  -p 127.0.0.1:3001:3001 -v /opt/kuma:/app/data louislam/uptime-kuma:2
# https://lighthouse.<tailnet>.ts.net
tailscale serve --bg 3001
"""

# ------------------------------------------------------------- instances

tetrapod = aws.ec2.Instance(
    "tetrapod",
    ami=ami_id,
    instance_type=INSTANCE_TYPE,
    key_name=key_pair.key_name,
    vpc_security_group_ids=[sg.id],
    iam_instance_profile=instance_profile.name,
    user_data=user_data("tetrapod"),
    user_data_replace_on_change=False,  # never recreate the pet over cloud-init edits
    disable_api_termination=True,       # the pet is termination-protected
    credit_specification=aws.ec2.InstanceCreditSpecificationArgs(cpu_credits="unlimited"),
    metadata_options=aws.ec2.InstanceMetadataOptionsArgs(http_tokens="required"),
    root_block_device=aws.ec2.InstanceRootBlockDeviceArgs(
        volume_size=ROOT_GB,
        volume_type="gp3",
        encrypted=True,
        tags={"Name": "tetrapod-root", "Backup": "tetrapod"},
    ),
    tags={"Name": "tetrapod", "Project": "tetrapod"},
)

lighthouse = aws.ec2.Instance(
    "lighthouse",
    ami=ami_id,
    instance_type=LIGHTHOUSE_TYPE,
    key_name=key_pair.key_name,
    vpc_security_group_ids=[sg.id],
    iam_instance_profile=instance_profile.name,
    user_data=user_data("lighthouse", LIGHTHOUSE_EXTRA),
    user_data_replace_on_change=False,
    metadata_options=aws.ec2.InstanceMetadataOptionsArgs(http_tokens="required"),
    root_block_device=aws.ec2.InstanceRootBlockDeviceArgs(
        volume_size=10, volume_type="gp3", encrypted=True,
        tags={"Name": "lighthouse-root"},
    ),
    tags={"Name": "lighthouse", "Project": "tetrapod"},
)

# ------------------------------------------------- ebs snapshots (dlm, daily)

dlm_role = aws.iam.Role(
    "tetrapod-dlm",
    assume_role_policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "dlm.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    }),
    tags={"Project": "tetrapod"},
)
aws.iam.RolePolicyAttachment(
    "tetrapod-dlm-service",
    role=dlm_role.name,
    policy_arn="arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole",
)
aws.dlm.LifecyclePolicy(
    "tetrapod-snapshots",
    description="daily snapshot of tetrapod root - keep 30",  # dlm allows only [0-9A-Za-z _-]
    execution_role_arn=dlm_role.arn,
    state="ENABLED",
    policy_details=aws.dlm.LifecyclePolicyPolicyDetailsArgs(
        resource_types=["VOLUME"],
        target_tags={"Backup": "tetrapod"},
        schedules=[aws.dlm.LifecyclePolicyPolicyDetailsScheduleArgs(
            name="daily",
            create_rule=aws.dlm.LifecyclePolicyPolicyDetailsScheduleCreateRuleArgs(
                interval=24, interval_unit="HOURS", times="09:00",  # 1am pacific
            ),
            retain_rule=aws.dlm.LifecyclePolicyPolicyDetailsScheduleRetainRuleArgs(count=30),
            copy_tags=True,
        )],
    ),
    tags={"Project": "tetrapod"},
)

# ------------------------------------------------------------- budget alarm

if BUDGET_EMAIL:
    aws.budgets.Budget(
        "tetrapod-monthly",
        budget_type="COST",
        limit_amount=BUDGET_LIMIT,
        limit_unit="USD",
        time_unit="MONTHLY",
        notifications=[
            aws.budgets.BudgetNotificationArgs(
                comparison_operator="GREATER_THAN",
                threshold=80, threshold_type="PERCENTAGE",
                notification_type="ACTUAL",
                subscriber_email_addresses=[BUDGET_EMAIL],
            ),
            aws.budgets.BudgetNotificationArgs(
                comparison_operator="GREATER_THAN",
                threshold=100, threshold_type="PERCENTAGE",
                notification_type="FORECASTED",
                subscriber_email_addresses=[BUDGET_EMAIL],
            ),
        ],
    )

pulumi.export("tetrapod_id", tetrapod.id)
pulumi.export("tetrapod_public_ip", tetrapod.public_ip)
pulumi.export("lighthouse_id", lighthouse.id)
pulumi.export("lighthouse_public_ip", lighthouse.public_ip)
