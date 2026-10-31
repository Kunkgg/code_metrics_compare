from decimal import Decimal

from cmetrics_cmp_viz import __version__


def test_version() -> None:
    assert __version__ == "0.1.0"


def test_half_up_rounding_baseline() -> None:
    """默认两位采用十进制 Half-Up，底层工具仍允许显式高精度。"""
    from cmetrics_cmp_viz.schema import round_half_up

    assert round_half_up(Decimal("12.345")) == 12.35
    assert round_half_up(Decimal("12.344999")) == 12.34
    assert round_half_up(Decimal("12.345001")) == 12.35
    assert round_half_up(2.675) == 2.68
    assert round_half_up(Decimal("-12.345")) == -12.35
    assert round_half_up(Decimal("12.3456785"), decimals=6) == 12.345679
    assert round_half_up(Decimal("12.3456784"), decimals=6) == 12.345678


def test_safe_div_percentage_precision() -> None:
    """百分数取两位，边界采用 Half-Up 而非银行家舍入."""
    from cmetrics_cmp_viz.schema import safe_div

    assert safe_div(1, 3, 100) == 33.33
    assert safe_div(1, 6, 100) == 16.67
    assert safe_div(1, 32, 100) == 3.13  # 3.125 的恰好中点
    assert safe_div(6249, 200000, 100) == 3.12  # 中点下方
    assert safe_div(6251, 200000, 100) == 3.13  # 中点上方
    assert safe_div(0, 0, 100) == 0


def test_safe_div_mean_and_density_precision() -> None:
    """均值和密度统一两位，覆盖 Half-Up 中点及其两侧。"""
    from cmetrics_cmp_viz.schema import safe_div

    assert safe_div(1, 3) == 0.33
    assert safe_div(1, 6) == 0.17
    assert safe_div(1, 6, 1000) == 166.67
    for multiplier in (1, 1000):
        assert safe_div(1, 8 * multiplier, multiplier) == 0.13  # 0.125 中点
        assert safe_div(2499, 20000 * multiplier, multiplier) == 0.12
        assert safe_div(2501, 20000 * multiplier, multiplier) == 0.13
    assert safe_div(1, 999, 1000) == 1.00
    assert safe_div(1, 1001, 1000) == 1.00
    assert safe_div(2, 1001, 1000) == 2.00
    assert safe_div(1, 0) == 0
    assert safe_div(1, 0, 1000) == 0
