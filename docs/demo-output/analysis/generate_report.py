# -*- coding: utf-8 -*-
"""用 Python 标准库读取 uploads/sales.csv，统计指标并生成一页式中文管理层销售摘要。"""
import csv
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "uploads" / "sales.csv"
REPORT_PATH = BASE_DIR / "analysis-report.md"


def money(value):
    return f"{value:,.0f}"


def pct(part, whole):
    return f"{(part / whole * 100):.1f}%"


def load_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def summarize(rows, key):
    grouped = defaultdict(lambda: {"records": 0, "qty": 0, "amount": Decimal(0)})
    for row in rows:
        bucket = grouped[row[key]]
        bucket["records"] += 1
        bucket["qty"] += int(row["数量"])
        bucket["amount"] += Decimal(row["销售额"])
    return dict(sorted(grouped.items(), key=lambda item: item[1]["amount"], reverse=True))


def build_report(rows):
    record_count = len(rows)
    total_qty = sum(int(row["数量"]) for row in rows)
    total_amount = sum(Decimal(row["销售额"]) for row in rows)
    avg_amount = total_amount / record_count
    avg_price = total_amount / total_qty
    dates = sorted(row["日期"] for row in rows)

    regions = summarize(rows, "地区")
    products = summarize(rows, "产品")

    lines = []
    add = lines.append

    add("# 销售管理摘要")
    add("")
    add(
        f"**统计周期**：{dates[0]} 至 {dates[-1]}（{record_count} 天） ｜ "
        f"**数据来源**：`uploads/sales.csv`（{record_count} 条记录，金额按原始行累加，未做退款、折扣或净额调整）"
    )
    add("")
    add("## 一、核心指标")
    add("")
    add("| 记录数 | 总数量 | 总销售额 | 平均每笔 | 平均单价 |")
    add("| --- | --- | --- | --- | --- |")
    add(
        f"| {record_count} | {total_qty} | {money(total_amount)} 元 | "
        f"{money(avg_amount)} 元 | {avg_price:.2f} 元 |"
    )
    add("")
    add("## 二、地区与产品结构")
    add("")
    add("| 地区 | 记录数 | 数量 | 销售额 | 占比 |")
    add("| --- | --- | --- | --- | --- |")
    for name, stats in regions.items():
        add(
            f"| {name} | {stats['records']} | {stats['qty']} | {money(stats['amount'])} 元 "
            f"| {pct(stats['amount'], total_amount)} |"
        )
    add(
        f"| **合计** | **{record_count}** | **{total_qty}** | **{money(total_amount)} 元** | **100.0%** |"
    )
    add("")

    top_region, top_stats = next(iter(regions.items()))
    last_region, last_stats = list(regions.items())[-1]
    gap = top_stats["amount"] - last_stats["amount"]
    top_product, top_product_stats = next(iter(products.items()))
    last_product, last_product_stats = list(products.items())[-1]
    price_note = "；".join(
        f"{name} 约 {stats['amount'] / stats['qty']:.0f} 元/件" for name, stats in products.items()
    )
    add(
        f"- **地区**：{top_region} {money(top_stats['amount'])} 元居首"
        f"（{pct(top_stats['amount'], total_amount)}），{last_region} {money(last_stats['amount'])} 元最低，"
        f"差额 {money(gap)} 元。"
    )
    add(
        f"- **产品**：{top_product} {money(top_product_stats['amount'])} 元"
        f"（{pct(top_product_stats['amount'], total_amount)}，{top_product_stats['qty']} 件）"
        f"＞ {last_product} {money(last_product_stats['amount'])} 元；{price_note}，高单价产品是当前金额主力。"
    )
    add("")
    add("## 三、两条建议")
    add("")
    add(
        f"1. **补强弱势地区、复制强势地区经验**：{last_region}仅 {money(last_stats['amount'])} 元，"
        f"比{top_region}少 {money(gap)} 元，记录数（{last_stats['records']}）也偏少。先核查是渠道覆盖不足"
        f"还是需求偏弱，再按{top_region}的成交方式小范围试点，并为{last_region}设定下期金额与笔数双目标。"
    )
    add(
        f"2. **稳住高单价供给、兼顾毛利**：{top_product}以 {top_product_stats['qty']} 件贡献 "
        f"{money(top_product_stats['amount'])} 元，金额占比高于数量占比。维持其供给与报价，"
        "同时检查低价产品的折扣力度与毛利水平，避免只追金额不追利润。"
    )
    add("")
    add("## 四、结论使用限制")
    add("")
    add(
        f"- 本期仅覆盖 {dates[0]} 至 {dates[-1]} 共 {record_count} 天、{record_count} 笔记录，"
        "属于单一时段快照，**无法据此判断增长、趋势或季节性**，须与上期/同期对比后再下结论。"
    )
    add("- 缺少成本、毛利、渠道与客户分层字段，本摘要只反映金额与数量，不代表真实盈利能力。")
    add("- 样本极小，单笔大额订单即可改变地区与产品排名，不宜作为长期资源配置的唯一依据。")
    add("")
    return "\n".join(lines)


def main():
    rows = load_rows(CSV_PATH)
    REPORT_PATH.write_text(build_report(rows), encoding="utf-8")
    print(f"记录数={len(rows)}")
    print(f"总数量={sum(int(r['数量']) for r in rows)}")
    print(f"总销售额={sum(Decimal(r['销售额']) for r in rows)}")
    print(f"报告已生成: {REPORT_PATH}")


if __name__ == "__main__":
    main()
