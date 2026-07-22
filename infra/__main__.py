"""tetrapod infra: two protected pets plus disposable research compute.

Hard rule: nothing here may ever touch Bedrock or Bedrock-related IAM.
IAM is limited to SSM/DLM and isolated AWS Batch service roles.
"""

import json

import pulumi
import pulumi_aws as aws

cfg = pulumi.Config()

INSTANCE_TYPE = cfg.get("instanceType") or "t4g.xlarge"
LIGHTHOUSE_TYPE = cfg.get("lighthouseType") or "t4g.micro"
ROOT_GB = cfg.get_int("rootVolumeGb") or 100
MEDIA_GB = cfg.get_int("mediaVolumeGb") or 1024  # st1 HDD, grows online, never shrinks
SSH_PUBLIC_KEY = cfg.require("sshPublicKey")
TS_AUTH_KEY = cfg.require_secret("tailscaleAuthKey")  # reusable + pre-approved key
BUDGET_EMAIL = cfg.get("budgetEmail")
BUDGET_LIMIT = cfg.get("budgetLimit") or "150"
BATCH_MAX_VCPUS = cfg.get_int("batchMaxVcpus") or 256
BATCH_ROOT_GB = cfg.get_int("batchRootVolumeGb") or 100
# break-glass only; tailscale-ssh is the real door. flip with:
#   pulumi config set tetrapod:enablePublicSsh true && pulumi up
ENABLE_PUBLIC_SSH = cfg.get_bool("enablePublicSsh") or False

# ubuntu 24.04 LTS arm64, always-current AMI via canonical's SSM parameter
ami_id = aws.ssm.get_parameter(
    name="/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id"
).value

default_vpc = aws.ec2.get_vpc(default=True)
default_subnets = aws.ec2.get_subnets(filters=[
    aws.ec2.GetSubnetsFilterArgs(name="vpc-id", values=[default_vpc.id]),
    aws.ec2.GetSubnetsFilterArgs(name="default-for-az", values=["true"]),
])

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
    opts=pulumi.ResourceOptions(protect=True, ignore_changes=["ami", "userData"]),
)

# media library volume: st1 throughput HDD (linear reads, jellyfin-grade).
# deliberately NOT tagged Backup=tetrapod — media is re-downloadable, DLM
# snapshotting a terabyte of anime would cost more than the disk. restic
# covers the configs; this volume covers itself by being replaceable.
media_volume = aws.ebs.Volume(
    "tetrapod-media",
    availability_zone=tetrapod.availability_zone,
    size=MEDIA_GB,
    type="st1",
    encrypted=True,
    tags={"Name": "tetrapod-media", "Project": "tetrapod"},
    opts=pulumi.ResourceOptions(protect=True),
)
aws.ec2.VolumeAttachment(
    "tetrapod-media",
    device_name="/dev/sdf",  # shows up as /dev/nvme1n1 on nitro
    volume_id=media_volume.id,
    instance_id=tetrapod.id,
    stop_instance_before_detaching=True,
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
    opts=pulumi.ResourceOptions(protect=True, ignore_changes=["ami", "userData"]),
)

# ---------------------------------------- disposable CPU research cluster

# AWS Batch has no control-plane charge and this managed environment scales to
# zero. Workers are separate Spot instances; they never share lifecycle, IAM,
# security groups, disks, or launch templates with either protected pet above.
batch_tags = {"Project": "hadwiger-nelson", "Workload": "research"}

batch_sg = aws.ec2.SecurityGroup(
    "hn-batch",
    vpc_id=default_vpc.id,
    description="Hadwiger-Nelson Batch workers: no ingress",
    ingress=[],
    egress=[aws.ec2.SecurityGroupEgressArgs(
        protocol="-1", from_port=0, to_port=0, cidr_blocks=["0.0.0.0/0"],
    )],
    tags=batch_tags,
)

batch_service_role = aws.iam.Role(
    "hn-batch-service",
    assume_role_policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "batch.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    }),
    tags=batch_tags,
)
batch_service_policy = aws.iam.RolePolicyAttachment(
    "hn-batch-service",
    role=batch_service_role.name,
    policy_arn="arn:aws:iam::aws:policy/service-role/AWSBatchServiceRole",
)

batch_instance_role = aws.iam.Role(
    "hn-batch-instance",
    assume_role_policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "ec2.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    }),
    tags=batch_tags,
)
batch_instance_policy = aws.iam.RolePolicyAttachment(
    "hn-batch-instance",
    role=batch_instance_role.name,
    policy_arn="arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
)
batch_instance_profile = aws.iam.InstanceProfile(
    "hn-batch-instance", role=batch_instance_role.name,
)

batch_spot_role = aws.iam.Role(
    "hn-batch-spot",
    assume_role_policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "spotfleet.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    }),
    tags=batch_tags,
)
batch_spot_policy = aws.iam.RolePolicyAttachment(
    "hn-batch-spot",
    role=batch_spot_role.name,
    policy_arn="arn:aws:iam::aws:policy/service-role/AmazonEC2SpotFleetTaggingRole",
)

batch_launch_template = aws.ec2.LaunchTemplate(
    "hn-batch",
    description="Ephemeral x86 SAT and graph-search workers",
    update_default_version=True,
    metadata_options=aws.ec2.LaunchTemplateMetadataOptionsArgs(
        http_tokens="required",
    ),
    block_device_mappings=[aws.ec2.LaunchTemplateBlockDeviceMappingArgs(
        device_name="/dev/xvda",
        ebs=aws.ec2.LaunchTemplateBlockDeviceMappingEbsArgs(
            delete_on_termination="true",
            encrypted="true",
            volume_size=BATCH_ROOT_GB,
            volume_type="gp3",
        ),
    )],
    tag_specifications=[
        aws.ec2.LaunchTemplateTagSpecificationArgs(
            resource_type="instance", tags=batch_tags,
        ),
        aws.ec2.LaunchTemplateTagSpecificationArgs(
            resource_type="volume", tags=batch_tags,
        ),
    ],
    tags=batch_tags,
)

batch_compute = aws.batch.ComputeEnvironment(
    "hn-spot",
    type="MANAGED",
    state="ENABLED",
    service_role=batch_service_role.arn,
    compute_resources=aws.batch.ComputeEnvironmentComputeResourcesArgs(
        type="SPOT",
        allocation_strategy="SPOT_CAPACITY_OPTIMIZED",
        min_vcpus=0,
        desired_vcpus=0,
        max_vcpus=BATCH_MAX_VCPUS,
        instance_types=[
            "c6a.8xlarge", "c6a.12xlarge", "c6a.16xlarge",
            "c7a.8xlarge", "c7a.12xlarge", "c7a.16xlarge",
            "c7i.8xlarge", "c7i.12xlarge", "c7i.16xlarge",
        ],
        instance_role=batch_instance_profile.arn,
        spot_iam_fleet_role=batch_spot_role.arn,
        security_group_ids=[batch_sg.id],
        subnets=default_subnets.ids,
        launch_template=aws.batch.ComputeEnvironmentComputeResourcesLaunchTemplateArgs(
            launch_template_id=batch_launch_template.id,
            version=batch_launch_template.latest_version.apply(str),
        ),
        tags=batch_tags,
    ),
    tags=batch_tags,
    opts=pulumi.ResourceOptions(depends_on=[
        batch_service_policy, batch_instance_policy, batch_spot_policy,
    ]),
)

batch_queue = aws.batch.JobQueue(
    "hn-cpu",
    state="ENABLED",
    priority=1,
    compute_environment_orders=[aws.batch.JobQueueComputeEnvironmentOrderArgs(
        order=1, compute_environment=batch_compute.arn,
    )],
    tags=batch_tags,
)

batch_smoke_job = aws.batch.JobDefinition(
    "hn-cpu-smoke",
    type="container",
    platform_capabilities=["EC2"],
    container_properties=json.dumps({
        "image": "public.ecr.aws/amazonlinux/amazonlinux:2023",
        "command": ["bash", "-lc", "nproc && uname -m && echo HN_BATCH_OK"],
        "resourceRequirements": [
            {"type": "VCPU", "value": "1"},
            {"type": "MEMORY", "value": "1024"},
        ],
    }),
    retry_strategy=aws.batch.JobDefinitionRetryStrategyArgs(attempts=1),
    timeout=aws.batch.JobDefinitionTimeoutArgs(attempt_duration_seconds=600),
    tags=batch_tags,
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
pulumi.export("tetrapod_media_volume_id", media_volume.id)
pulumi.export("lighthouse_id", lighthouse.id)
pulumi.export("lighthouse_public_ip", lighthouse.public_ip)
pulumi.export("hn_batch_max_vcpus", BATCH_MAX_VCPUS)
pulumi.export("hn_batch_queue_arn", batch_queue.arn)
pulumi.export("hn_batch_smoke_job_arn", batch_smoke_job.arn)
