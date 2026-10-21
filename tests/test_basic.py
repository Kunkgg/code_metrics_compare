from decimal import ROUND_HALF_UP, Decimal

from cmetrics_cmp_viz import __version__


def test_version() -> None:
    assert __version__ == "0.1.0"


def test_half_up_rounding_baseline() -> None:
    """验证 PRD §5.1 数值计算基线：十进制 Half-Up 舍入至多 6 位小数."""
    val = Decimal("12.3456785")
    rounded = val.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    assert str(rounded) == "12.345679"

    val_down = Decimal("12.3456784")
    rounded_down = val_down.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    assert str(rounded_down) == "12.345678"
