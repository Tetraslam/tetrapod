import base64
import importlib.machinery
import importlib.util
import types
import unittest
from pathlib import Path
from unittest import mock

PATH = Path(__file__).parents[1] / "provision/bin/mit-graph-smtp"
LOADER = importlib.machinery.SourceFileLoader("mit_graph_smtp", str(PATH))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
MODULE = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(MODULE)


class AuthenticationTest(unittest.TestCase):
    def setUp(self):
        self.relay = MODULE.GraphRelay.__new__(MODULE.GraphRelay)
        self.relay.password = b"correct horse"

    def test_accepts_exact_account_and_password(self):
        credentials = MODULE.LoginPassword(b"shresht@mit.edu", b"correct horse")
        result = self.relay.authenticate(None, None, None, "PLAIN", credentials)
        self.assertTrue(result.success)

    def test_rejects_wrong_password(self):
        credentials = MODULE.LoginPassword(b"shresht@mit.edu", b"wrong")
        result = self.relay.authenticate(None, None, None, "PLAIN", credentials)
        self.assertFalse(result.success)


class DeliveryTest(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_other_envelope_sender(self):
        relay = MODULE.GraphRelay.__new__(MODULE.GraphRelay)
        envelope = types.SimpleNamespace(
            mail_from="attacker@example.com",
            rcpt_tos=["friend@example.com"],
            original_content=b"Subject: hello\r\n\r\nworld\r\n",
        )
        result = await relay.handle_DATA(None, None, envelope)
        self.assertEqual(result, "553 sender must be shresht@mit.edu")

    def test_graph_request_preserves_raw_mime(self):
        relay = MODULE.GraphRelay.__new__(MODULE.GraphRelay)
        relay.access_token = lambda: "token"
        content = b"Subject: folded\r\n\tvalue\r\n\r\nraw body\xff\r\n"
        response = mock.MagicMock(status=202)
        response.__enter__.return_value = response
        with mock.patch.object(MODULE.urllib.request, "urlopen", return_value=response) as urlopen:
            relay.send(content, [])
        request = urlopen.call_args.args[0]
        self.assertEqual(base64.b64decode(request.data), content)
        self.assertEqual(request.headers["Content-type"], "text/plain")

    def test_graph_request_adds_envelope_only_bcc_recipient(self):
        relay = MODULE.GraphRelay.__new__(MODULE.GraphRelay)
        relay.access_token = lambda: "token"
        content = b"To: friend@example.com\r\nSubject: hello\r\n\r\nworld\r\n"
        response = mock.MagicMock(status=202)
        response.__enter__.return_value = response
        with mock.patch.object(MODULE.urllib.request, "urlopen", return_value=response) as urlopen:
            relay.send(content, ["friend@example.com", "hidden@example.com"])
        sent = base64.b64decode(urlopen.call_args.args[0].data)
        self.assertIn(b"\r\nBcc: hidden@example.com\r\n\r\n", sent)


if __name__ == "__main__":
    unittest.main()
