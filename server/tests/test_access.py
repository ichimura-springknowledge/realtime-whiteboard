import pytest

from app.access import AccessGuard, InvalidRangeError, normalize_address


@pytest.mark.parametrize(
    "address, allowed",
    [
        ("127.0.0.1", True),
        ("::1", True),
        ("::ffff:192.168.1.55", True),
        ("192.168.1.55", True),
        ("10.4.5.6", True),
        ("172.16.0.1", True),
        ("172.31.255.254", True),
        ("172.32.0.1", False),
        ("172.15.255.255", False),
        ("169.254.1.1", True),
        ("203.0.113.5", False),
        ("8.8.8.8", False),
        ("2001:db8::1", False),
        ("fd00::1234", True),
        ("fe80::1%eth0", True),
        ("", False),
        (None, False),
        ("not-an-ip", False),
        ("192.168.1.999", False),
    ],
)
def test_default_policy_allows_only_private_addresses(address, allowed):
    assert AccessGuard().allows(address) is allowed


@pytest.mark.parametrize(
    "address, allowed",
    [
        ("192.168.1.201", True),
        ("192.168.1.1", True),
        ("192.168.2.5", False),
        ("10.4.5.6", False),
        ("127.0.0.1", True),  # loopback stays allowed so the host itself works
        ("203.0.113.5", False),
    ],
)
def test_narrowing_to_one_office_subnet(address, allowed):
    assert AccessGuard("192.168.1.0/24").allows(address) is allowed


@pytest.mark.parametrize(
    "address, allowed",
    [("10.9.9.9", True), ("192.168.1.7", True), ("172.16.0.1", False)],
)
def test_several_ranges(address, allowed):
    assert AccessGuard("192.168.1.0/24, 10.0.0.0/8").allows(address) is allowed


def test_single_host_range():
    guard = AccessGuard("192.168.1.50/32")
    assert guard.allows("192.168.1.50") is True
    assert guard.allows("192.168.1.51") is False


def test_office_global_address_can_be_allowed():
    guard = AccessGuard("119.243.97.249/32")
    assert guard.allows("119.243.97.249") is True
    assert guard.allows("119.243.97.250") is False
    # The default private ranges no longer apply once a range is configured.
    assert guard.allows("192.168.1.5") is False


def test_invalid_range_is_rejected_at_startup():
    with pytest.raises(InvalidRangeError):
        AccessGuard("nonsense")


def test_normalize_address_strips_mapping_and_zone():
    assert normalize_address("::ffff:10.0.0.1") == "10.0.0.1"
    assert normalize_address("fe80::1%eth0") == "fe80::1"
    assert normalize_address("  192.168.1.1  ") == "192.168.1.1"
    assert normalize_address(None) is None


def test_describe_reports_the_configured_range():
    assert AccessGuard("192.168.1.0/24").describe() == "192.168.1.0/24"
    assert "プライベート" in AccessGuard().describe()
