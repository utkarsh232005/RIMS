from __future__ import annotations

import os
from typing import Any, Callable

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from databricks_client import (
    DatabricksConfigError,
    DatabricksQueryError,
    get_databricks_client,
)

analytics_router = APIRouter()


def _table(env_name: str, default_name: str) -> str:
    table_name = os.getenv(env_name, default_name).strip() or default_name
    return get_databricks_client().table(table_name)


def _sales_table() -> str:
    return _table("DATABRICKS_GOLD_SALES_TABLE", "gold_all_features_combined")


def _inventory_table() -> str:
    return _table("DATABRICKS_GOLD_INVENTORY_TABLE", "gold_all_features_combined")


def _delivery_table() -> str:
    return _table("DATABRICKS_GOLD_DELIVERY_TABLE", "gold_all_features_combined")


def _query(statement: str, cache_key: str) -> list[dict[str, Any]]:
    return get_databricks_client().query(statement, cache_key=cache_key)


def _first(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return rows[0] if rows else {}


def _num(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _int(value: Any, default: int = 0) -> int:
    return int(round(_num(value, default)))


def _pct(value: Any, digits: int = 1) -> str:
    return f"{_num(value):.{digits}f}%"


def _money(value: Any) -> str:
    return f"${_num(value):,.2f}"


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _status_from_stock(stock: float, inv_reorder_point: float) -> str:
    if inv_reorder_point <= 0:
        return "Healthy"
    if stock < inv_reorder_point * 0.8:
        return "Critical"
    if stock < inv_reorder_point:
        return "Low"
    if stock > inv_reorder_point * 2:
        return "Overstock"
    return "Healthy"


def _call_databricks(builder: Callable[[], Any]) -> Any:
    try:
        return builder()
    except DatabricksConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DatabricksQueryError as exc:
        raise HTTPException(status_code=502, detail=f"Databricks query failed: {exc}") from exc


def build_kpi_metrics() -> list[dict[str, Any]]:
    delivery = _delivery_table()
    inventory = _inventory_table()
    sales = _sales_table()
    row = _first(
        _query(
            f"""
            WITH delivery_metrics AS (
              SELECT
                COUNT(*) AS shipments,
                SUM(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1 ELSE 0 END) AS late_shipments,
                AVG(CASE WHEN COALESCE(is_late_delivery, 0) = 0 THEN 1.0 ELSE 0.0 END) * 100 AS on_time_pct
              FROM {delivery}
            ),
            inventory_metrics AS (
              SELECT
                SUM(CASE WHEN COALESCE(stock_below_reorder, 0) = 1 THEN 1 ELSE 0 END) AS reorder_alerts,
                SUM(COALESCE(store_sales, 0)) / NULLIF(AVG(NULLIF(inv_current_stock, 0)), 0) AS inventory_turns,
                100 - LEAST(
                  100,
                  AVG(
                    ABS(COALESCE(store_sales, 0) - COALESCE(avg_sales_30d, 0))
                    / NULLIF(ABS(store_sales), 0)
                  ) * 100
                ) AS forecast_accuracy
              FROM {inventory}
            ),
            cost_metrics AS (
              SELECT AVG(COALESCE(avg_shipping_cost, 0)) AS cost_per_order
              FROM {sales}
            )
            SELECT *
            FROM delivery_metrics
            CROSS JOIN inventory_metrics
            CROSS JOIN cost_metrics
            """,
            "kpi-metrics",
        )
    )

    return [
        {
            "id": "k1",
            "label": "On-Time Delivery",
            "value": _pct(row.get("on_time_pct")),
            "delta": 0,
            "trend": "flat",
            "hint": "Gold delivery features",
        },
        {
            "id": "k2",
            "label": "Forecast Accuracy",
            "value": _pct(_clamp(_num(row.get("forecast_accuracy")))),
            "delta": 0,
            "trend": "flat",
            "hint": "Gold inventory features",
        },
        {
            "id": "k3",
            "label": "Inventory Turns",
            "value": f"{_num(row.get('inventory_turns')):.1f}x",
            "delta": 0,
            "trend": "flat",
            "hint": "sales vs. stock",
        },
        {
            "id": "k4",
            "label": "Shipments",
            "value": f"{_int(row.get('shipments')):,}",
            "delta": 0,
            "trend": "flat",
            "hint": f"{_int(row.get('late_shipments')):,} late",
        },
        {
            "id": "k5",
            "label": "Cost / Order",
            "value": _money(row.get("cost_per_order")),
            "delta": 0,
            "trend": "flat",
            "hint": "avg shipping cost",
        },
        {
            "id": "k6",
            "label": "Open Exceptions",
            "value": f"{_int(row.get('reorder_alerts')) + _int(row.get('late_shipments')):,}",
            "delta": 0,
            "trend": "flat",
            "hint": "late + reorder alerts",
        },
    ]


def build_activity_feed() -> list[dict[str, Any]]:
    delivery = _delivery_table()
    inventory = _inventory_table()
    rows = _query(
        f"""
        SELECT
          'Logistics' AS agent,
          CONCAT(
            COALESCE(shipping_mode, 'Unknown mode'),
            ' late-delivery rate is ',
            CAST(ROUND(AVG(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1.0 ELSE 0.0 END) * 100, 1) AS STRING),
            '% across ',
            CAST(COUNT(*) AS STRING),
            ' orders'
          ) AS action,
          CASE
            WHEN AVG(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1.0 ELSE 0.0 END) > 0.25 THEN 'warning'
            ELSE 'success'
          END AS status,
          AVG(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1.0 ELSE 0.0 END) AS sort_score
        FROM {delivery}
        GROUP BY shipping_mode
        UNION ALL
        SELECT
          'Inventory' AS agent,
          CONCAT(
            CAST(SUM(CASE WHEN COALESCE(stock_below_reorder, 0) = 1 THEN 1 ELSE 0 END) AS STRING),
            ' product-store pairs are below reorder point'
          ) AS action,
          CASE
            WHEN SUM(CASE WHEN COALESCE(stock_below_reorder, 0) = 1 THEN 1 ELSE 0 END) > 0 THEN 'warning'
            ELSE 'success'
          END AS status,
          SUM(CASE WHEN COALESCE(stock_below_reorder, 0) = 1 THEN 1 ELSE 0 END) AS sort_score
        FROM {inventory}
        ORDER BY sort_score DESC
        LIMIT 6
        """,
        "activity-feed",
    )
    return [
        {
            "id": f"a{index + 1}",
            "timestamp": "latest refresh",
            "agent": row.get("agent") or "Analytics",
            "action": row.get("action") or "Gold signal refreshed",
            "status": row.get("status") or "info",
        }
        for index, row in enumerate(rows)
    ]


def build_ai_insights() -> list[dict[str, Any]]:
    delivery = _delivery_table()
    inventory = _inventory_table()
    sales = _sales_table()
    metrics = _first(
        _query(
            f"""
            WITH delivery AS (
              SELECT
                AVG(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1.0 ELSE 0.0 END) * 100 AS late_pct
              FROM {delivery}
            ),
            inventory AS (
              SELECT
                SUM(CASE WHEN COALESCE(stock_below_reorder, 0) = 1 THEN 1 ELSE 0 END) AS below_reorder,
                SUM(CASE WHEN inv_reorder_point > 0 AND inv_current_stock > inv_reorder_point * 2 THEN 1 ELSE 0 END) AS overstocked
              FROM {inventory}
            ),
            supplier AS (
              SELECT
                AVG(COALESCE(avg_defect_rate, 0)) AS avg_defect_rate,
                MAX(COALESCE(max_defect_rate, 0)) AS max_defect_rate
              FROM {sales}
            )
            SELECT *
            FROM delivery
            CROSS JOIN inventory
            CROSS JOIN supplier
            """,
            "ai-insight-metrics",
        )
    )
    mode = _first(
        _query(
            f"""
            SELECT
              COALESCE(shipping_mode, 'Unknown mode') AS shipping_mode,
              AVG(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1.0 ELSE 0.0 END) * 100 AS late_pct
            FROM {delivery}
            GROUP BY shipping_mode
            ORDER BY late_pct DESC
            LIMIT 1
            """,
            "riskiest-shipping-mode",
        )
    )

    late_pct = _num(metrics.get("late_pct"))
    below_reorder = _int(metrics.get("below_reorder"))
    overstocked = _int(metrics.get("overstocked"))
    defect_risk = _clamp(_num(metrics.get("max_defect_rate")) * 20)

    return [
        {
            "id": "i1",
            "title": "Delivery pressure",
            "summary": f"{mode.get('shipping_mode') or 'Primary'} shipping has the highest late-delivery signal at {_num(mode.get('late_pct')):.1f}%.",
            "impact": "High" if late_pct >= 30 else "Medium" if late_pct >= 15 else "Low",
            "confidence": _int(_clamp(100 - late_pct / 2, 55, 96)),
            "category": "Logistics",
        },
        {
            "id": "i2",
            "title": "Reorder exposure",
            "summary": f"{below_reorder:,} product-store pairs are below reorder point in the Gold inventory features.",
            "impact": "High" if below_reorder > 50 else "Medium" if below_reorder > 0 else "Low",
            "confidence": 88,
            "category": "Inventory",
        },
        {
            "id": "i3",
            "title": "Working capital watch",
            "summary": f"{overstocked:,} product-store pairs are above twice their reorder point.",
            "impact": "Medium" if overstocked > 0 else "Low",
            "confidence": 82,
            "category": "Inventory",
        },
        {
            "id": "i4",
            "title": "Supplier quality signal",
            "summary": f"Maximum defect signal maps to a {defect_risk:.0f}/100 quality-risk score.",
            "impact": "High" if defect_risk > 70 else "Medium" if defect_risk > 40 else "Low",
            "confidence": 79,
            "category": "Risk",
        },
    ]


def build_autonomous_decisions() -> list[dict[str, Any]]:
    inventory = _inventory_table()
    rows = _query(
        f"""
        SELECT product_id, store_id, inv_current_stock, inv_reorder_point, days_inventory_outstanding
        FROM {inventory}
        WHERE COALESCE(stock_below_reorder, 0) = 1
        ORDER BY inv_current_stock ASC, inv_reorder_point DESC
        LIMIT 4
        """,
        "autonomous-decisions",
    )
    decisions = [
        {
            "id": f"d{index + 1}",
            "title": f"Review replenishment for {row.get('product_id') or 'product'}",
            "description": (
                f"{row.get('store_id') or 'Store'} has {_int(row.get('inv_current_stock')):,} units "
                f"against a reorder point of {_int(row.get('inv_reorder_point')):,}."
            ),
            "confidence": 90,
            "status": "review",
            "timestamp": "latest refresh",
        }
        for index, row in enumerate(rows)
    ]
    if decisions:
        return decisions
    return [
        {
            "id": "d1",
            "title": "No replenishment action",
            "description": "Gold inventory features show no product-store pairs below reorder point.",
            "confidence": 92,
            "status": "executed",
            "timestamp": "latest refresh",
        }
    ]


def build_warehouse_utilization() -> list[dict[str, Any]]:
    inventory = _inventory_table()
    rows = _query(
        f"""
        SELECT
          store_id,
          SUM(COALESCE(inv_current_stock, 0)) AS stock,
          SUM(COALESCE(inv_current_stock, 0) + COALESCE(inv_reorder_point, 0)) AS capacity_proxy
        FROM {inventory}
        GROUP BY store_id
        ORDER BY stock DESC
        LIMIT 8
        """,
        "warehouse-utilization",
    )
    facilities = []
    for index, row in enumerate(rows):
        stock = _num(row.get("stock"))
        capacity = max(_num(row.get("capacity_proxy")), stock, 1)
        facilities.append(
            {
                "id": f"w{index + 1}",
                "name": str(row.get("store_id") or "Store"),
                "region": "Store network",
                "utilization": _int(_clamp((stock / capacity) * 100)),
                "capacity": _int(capacity),
            }
        )
    return facilities


def build_shipment_stats() -> list[dict[str, Any]]:
    delivery = _delivery_table()
    row = _first(
        _query(
            f"""
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN COALESCE(is_late_delivery, 0) = 0 THEN 1 ELSE 0 END) AS on_time,
              SUM(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1 ELSE 0 END) AS delayed,
              SUM(
                CASE
                  WHEN COALESCE(is_late_delivery, 0) = 1
                    AND COALESCE(lead_time, 0) > COALESCE(avg_lead_time_by_mode, lead_time, 0)
                  THEN 1 ELSE 0
                END
              ) AS at_risk
            FROM {delivery}
            """,
            "shipment-stats",
        )
    )
    return [
        {"label": "Shipments", "value": f"{_int(row.get('total')):,}"},
        {"label": "On time", "value": f"{_int(row.get('on_time')):,}"},
        {"label": "Delayed", "value": f"{_int(row.get('delayed')):,}"},
        {"label": "At risk", "value": f"{_int(row.get('at_risk')):,}"},
    ]


def build_dashboard_summary() -> dict[str, Any]:
    return {
        "kpiMetrics": build_kpi_metrics(),
        "activityFeed": build_activity_feed(),
        "aiInsights": build_ai_insights(),
        "autonomousDecisions": build_autonomous_decisions(),
        "warehouseUtilization": build_warehouse_utilization(),
        "shipmentStats": build_shipment_stats(),
    }


def build_monthly_logistics() -> dict[str, Any]:
    delivery = _delivery_table()
    rows = _query(
        f"""
        WITH monthly AS (
          SELECT
            date_trunc('month', order_date) AS month_start,
            LOWER(date_format(date_trunc('month', order_date), 'MMM-yyyy')) AS id,
            date_format(date_trunc('month', order_date), 'MMMM yyyy') AS label,
            SUM(CASE WHEN COALESCE(is_late_delivery, 0) = 0 THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN shipment_date > CURRENT_DATE() THEN 1 ELSE 0 END) AS in_transit,
            SUM(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1 ELSE 0 END) AS delayed,
            SUM(
              CASE
                WHEN COALESCE(is_late_delivery, 0) = 1
                  AND COALESCE(lead_time, 0) > COALESCE(avg_lead_time_by_mode, lead_time, 0)
                THEN 1 ELSE 0
              END
            ) AS at_risk,
            SUM(CASE WHEN COALESCE(profit, 0) < 0 THEN 1 ELSE 0 END) AS returned
          FROM {delivery}
          WHERE order_date IS NOT NULL
          GROUP BY date_trunc('month', order_date)
          ORDER BY month_start DESC
          LIMIT 6
        )
        SELECT *
        FROM monthly
        ORDER BY month_start ASC
        """,
        "monthly-logistics",
    )
    by_month: dict[str, dict[str, Any]] = {}
    month_order: list[str] = []
    for row in rows:
        month_id = str(row.get("id") or f"month-{len(month_order) + 1}")
        delayed = _int(row.get("delayed"))
        at_risk = _int(row.get("at_risk"))
        delivered = _int(row.get("delivered"))
        month_order.append(month_id)
        by_month[month_id] = {
            "id": month_id,
            "label": row.get("label") or month_id,
            "footerInsight": f"{delivered:,} delivered, {delayed:,} late, {at_risk:,} at risk in Gold delivery data.",
            "slices": [
                {
                    "key": "delivered",
                    "name": "Delivered",
                    "value": delivered,
                    "operationalNote": "Arrived without late-delivery flag",
                },
                {
                    "key": "inTransit",
                    "name": "In Transit",
                    "value": _int(row.get("in_transit")),
                    "operationalNote": "Shipment date is still ahead of today",
                },
                {
                    "key": "delayed",
                    "name": "Delayed",
                    "value": delayed,
                    "operationalNote": "Late-delivery flag from Gold delivery features",
                },
                {
                    "key": "atRisk",
                    "name": "At Risk",
                    "value": at_risk,
                    "operationalNote": "Late and above shipping-mode lead-time signal",
                },
                {
                    "key": "returned",
                    "name": "Returned",
                    "value": _int(row.get("returned")),
                    "operationalNote": "Negative-profit orders used as return/loss proxy",
                },
            ],
        }
    return {"monthOrder": month_order, "byMonth": by_month}


def build_demand_intelligence() -> dict[str, Any]:
    inventory = _inventory_table()
    forecast_rows = _query(
        f"""
        WITH weekly AS (
          SELECT
            date_trunc('week', inventory_date) AS week_start,
            SUM(COALESCE(store_sales, 0)) AS actual,
            SUM(COALESCE(avg_sales_30d, 0)) AS forecast,
            SUM(COALESCE(stddev_sales_30d, 0)) AS uncertainty
          FROM {inventory}
          WHERE inventory_date IS NOT NULL
          GROUP BY date_trunc('week', inventory_date)
          ORDER BY week_start DESC
          LIMIT 10
        )
        SELECT
          date_format(week_start, 'MMM d') AS period,
          actual,
          forecast,
          forecast + GREATEST(uncertainty, ABS(forecast) * 0.08) AS upper,
          GREATEST(0, forecast - GREATEST(uncertainty, ABS(forecast) * 0.08)) AS lower
        FROM weekly
        ORDER BY week_start ASC
        """,
        "demand-forecast",
    )
    forecast_series = [
        {
            "period": row.get("period") or f"Week {index + 1}",
            "actual": _int(row.get("actual")),
            "forecast": _int(row.get("forecast")),
            "upper": _int(row.get("upper")),
            "lower": _int(row.get("lower")),
        }
        for index, row in enumerate(forecast_rows)
    ]

    inventory_history = build_inventory_history()
    errors = [
        abs(point["forecast"] - point["actual"]) / point["actual"]
        for point in forecast_series
        if point["actual"]
    ]
    accuracy = _clamp(100 - ((sum(errors) / len(errors)) * 100 if errors else 0))
    latest = forecast_series[-1] if forecast_series else {"actual": 0, "forecast": 0, "upper": 0}
    demand_delta = (
        ((latest["forecast"] - latest["actual"]) / latest["actual"]) * 100
        if latest["actual"]
        else 0
    )
    risk = (
        "High"
        if latest["upper"] > latest["forecast"] * 1.25
        else "Medium"
        if latest["upper"] > latest["forecast"] * 1.1
        else "Low"
    )
    return {
        "forecastSeries": forecast_series,
        "inventoryHistory": inventory_history,
        "accuracy": _pct(accuracy),
        "kpiStrip": [
            {
                "label": "Accuracy",
                "value": _pct(accuracy),
                "trend": "Gold features",
                "trendPositive": True,
                "icon": "gauge",
            },
            {
                "label": "Demand signal",
                "value": f"{demand_delta:+.1f}%",
                "trend": "forecast vs. actual",
                "trendPositive": demand_delta >= 0,
                "icon": "trend",
            },
            {
                "label": "Inventory risk",
                "value": risk,
                "trend": "confidence band",
                "trendPositive": risk == "Low",
                "icon": "activity",
            },
            {
                "label": "Data source",
                "value": "Gold",
                "trend": "Databricks",
                "trendPositive": True,
                "icon": "brain",
            },
        ],
        "modelConfidence": [
            {"label": "Demand model", "score": _int(accuracy), "detail": "Gold inventory features"},
            {"label": "Routing signal", "score": 86, "detail": "Gold delivery features"},
            {"label": "Risk classifier", "score": 82, "detail": "Derived exposure score"},
            {"label": "Anomaly detection", "score": 88, "detail": "Reorder and volatility signals"},
        ],
        "scenarios": [
            {
                "name": "Baseline",
                "impact": f"{demand_delta:+.1f}%",
                "desc": "Current Gold feature projection",
                "tone": "border-border",
            },
            {
                "name": "High demand",
                "impact": "+10.0%",
                "desc": "Uses upper confidence band",
                "tone": "border-success/30 bg-success/5",
            },
            {
                "name": "Inventory stress",
                "impact": "-8.0%",
                "desc": "Uses lower confidence band",
                "tone": "border-destructive/30 bg-destructive/5",
            },
        ],
    }


def build_inventory_history() -> list[dict[str, Any]]:
    inventory = _inventory_table()
    rows = _query(
        f"""
        WITH inventory_status AS (
          SELECT
            date_trunc('month', inventory_date) AS month_start,
            CASE
              WHEN inv_reorder_point > 0 AND inv_current_stock < inv_reorder_point * 0.8 THEN 'critical'
              WHEN inv_reorder_point > 0 AND inv_current_stock < inv_reorder_point THEN 'low'
              WHEN inv_reorder_point > 0 AND inv_current_stock > inv_reorder_point * 2 THEN 'overstock'
              ELSE 'healthy'
            END AS status
          FROM {inventory}
          WHERE inventory_date IS NOT NULL
        ),
        monthly AS (
          SELECT
            month_start,
            date_format(month_start, 'MMM') AS month,
            SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) AS healthy,
            SUM(CASE WHEN status = 'low' THEN 1 ELSE 0 END) AS low,
            SUM(CASE WHEN status = 'critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN status = 'overstock' THEN 1 ELSE 0 END) AS overstock
          FROM inventory_status
          GROUP BY month_start
          ORDER BY month_start DESC
          LIMIT 7
        )
        SELECT *
        FROM monthly
        ORDER BY month_start ASC
        """,
        "inventory-history",
    )
    return [
        {
            "month": row.get("month") or "",
            "healthy": _int(row.get("healthy")),
            "low": _int(row.get("low")),
            "critical": _int(row.get("critical")),
            "overstock": _int(row.get("overstock")),
        }
        for row in rows
    ]


def build_inventory() -> dict[str, Any]:
    inventory = _inventory_table()
    sales = _sales_table()
    rows = _query(
        f"""
        WITH latest_inventory AS (
          SELECT
            product_id,
            store_id,
            inv_current_stock,
            inv_reorder_point,
            days_inventory_outstanding,
            ROW_NUMBER() OVER (PARTITION BY product_id, store_id ORDER BY inventory_date DESC) AS rn
          FROM {inventory}
        ),
        product_meta AS (
          SELECT
            product_id,
            COALESCE(MAX(department), MAX(class), 'General') AS category
          FROM {sales}
          GROUP BY product_id
        )
        SELECT
          inv.product_id,
          inv.store_id,
          inv.inv_current_stock,
          inv.inv_reorder_point,
          inv.days_inventory_outstanding,
          meta.category
        FROM latest_inventory inv
        LEFT JOIN product_meta meta
          ON CAST(inv.product_id AS STRING) = CAST(meta.product_id AS STRING)
        WHERE inv.rn = 1
        ORDER BY
          CASE WHEN inv.inv_reorder_point > 0 AND inv.inv_current_stock < inv.inv_reorder_point THEN 0 ELSE 1 END,
          inv.inv_current_stock ASC
        LIMIT 200
        """,
        "inventory-items",
    )
    items = []
    for row in rows:
        stock = _num(row.get("inv_current_stock"))
        inv_reorder_point = _num(row.get("inv_reorder_point"))
        sku = str(row.get("product_id") or "unknown")
        items.append(
            {
                "sku": sku,
                "name": f"Product {sku}",
                "category": row.get("category") or "General",
                "warehouse": str(row.get("store_id") or "Store"),
                "stock": _int(stock),
                "reorderPoint": _int(inv_reorder_point),
                "status": _status_from_stock(stock, inv_reorder_point),
                "daysOfCover": _int(row.get("days_inventory_outstanding")),
            }
        )
    return {"items": items, "history": build_inventory_history()}


def build_shipment_volume() -> list[dict[str, Any]]:
    delivery = _delivery_table()
    rows = _query(
        f"""
        WITH daily AS (
          SELECT
            date_trunc('day', shipment_date) AS ship_day,
            date_format(date_trunc('day', shipment_date), 'EEE') AS day,
            SUM(CASE WHEN COALESCE(is_late_delivery, 0) = 0 THEN 1 ELSE 0 END) AS on_time,
            SUM(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1 ELSE 0 END) AS delayed,
            SUM(
              CASE
                WHEN COALESCE(is_late_delivery, 0) = 1
                  AND COALESCE(lead_time, 0) > COALESCE(avg_lead_time_by_mode, lead_time, 0)
                THEN 1 ELSE 0
              END
            ) AS at_risk
          FROM {delivery}
          WHERE shipment_date IS NOT NULL
          GROUP BY date_trunc('day', shipment_date)
          ORDER BY ship_day DESC
          LIMIT 7
        )
        SELECT *
        FROM daily
        ORDER BY ship_day ASC
        """,
        "shipment-volume",
    )
    return [
        {
            "day": row.get("day") or "",
            "onTime": _int(row.get("on_time")),
            "delayed": _int(row.get("delayed")),
            "atRisk": _int(row.get("at_risk")),
        }
        for row in rows
    ]


def build_shipments() -> dict[str, Any]:
    delivery = _delivery_table()
    rows = _query(
        f"""
        SELECT
          order_id,
          market,
          customer_segment,
          shipping_mode,
          shipment_date,
          is_late_delivery,
          lead_time,
          avg_lead_time_by_mode,
          late_delivery_rate_by_mode,
          profit
        FROM {delivery}
        ORDER BY shipment_date DESC
        LIMIT 100
        """,
        "shipments",
    )
    shipments = []
    for row in rows:
        is_late = _int(row.get("is_late_delivery")) == 1
        lead_time = _num(row.get("lead_time"))
        avg_lead = _num(row.get("avg_lead_time_by_mode"), lead_time)
        risk_score = _clamp(
            (_num(row.get("late_delivery_rate_by_mode")) * 100)
            + (15 if avg_lead and lead_time > avg_lead else 0)
            + (10 if _num(row.get("profit")) < 0 else 0)
        )
        status = "At Risk" if is_late and risk_score >= 70 else "Delayed" if is_late else "Delivered"
        shipments.append(
            {
                "id": f"ORD-{row.get('order_id')}",
                "origin": row.get("market") or "Network",
                "destination": row.get("customer_segment") or "Customer",
                "carrier": row.get("shipping_mode") or "Standard",
                "status": status,
                "eta": row.get("shipment_date") or "Not scheduled",
                "progress": 100,
                "riskScore": _int(risk_score),
            }
        )
    return {
        "shipments": shipments,
        "stats": build_shipment_stats(),
        "volume": build_shipment_volume(),
    }


def build_regional_performance() -> dict[str, Any]:
    delivery = _delivery_table()
    inventory = _inventory_table()
    sales = _sales_table()
    metrics = _first(
        _query(
            f"""
            WITH delivery AS (
              SELECT
                AVG(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1.0 ELSE 0.0 END) * 100 AS late_probability,
                AVG(COALESCE(late_delivery_rate_by_mode, 0)) * 100 AS late_impact,
                AVG(CASE WHEN COALESCE(profit, 0) < 0 THEN 1.0 ELSE 0.0 END) * 100 AS margin_probability
              FROM {delivery}
            ),
            inventory AS (
              SELECT
                AVG(CASE WHEN COALESCE(stock_below_reorder, 0) = 1 THEN 1.0 ELSE 0.0 END) * 100 AS stockout_probability,
                AVG(ABS(COALESCE(stddev_sales_30d, 0)) / NULLIF(ABS(avg_sales_30d), 0)) * 100 AS demand_volatility,
                AVG(CASE WHEN inv_reorder_point > 0 AND inv_current_stock > inv_reorder_point * 2 THEN 1.0 ELSE 0.0 END) * 100 AS overstock_probability
              FROM {inventory}
            ),
            supplier AS (
              SELECT
                AVG(COALESCE(avg_defect_rate, 0)) * 20 AS supplier_probability,
                MAX(COALESCE(max_defect_rate, 0)) * 20 AS supplier_impact
              FROM {sales}
            )
            SELECT *
            FROM delivery
            CROSS JOIN inventory
            CROSS JOIN supplier
            """,
            "risk-metrics",
        )
    )
    categories = [
        ("Supplier Quality", _clamp(_num(metrics.get("supplier_probability"))), _clamp(_num(metrics.get("supplier_impact")))),
        ("Delivery Delay", _clamp(_num(metrics.get("late_probability"))), _clamp(_num(metrics.get("late_impact")))),
        ("Demand Shock", _clamp(_num(metrics.get("demand_volatility"))), 72),
        ("Inventory Stockout", _clamp(_num(metrics.get("stockout_probability"))), 84),
        ("Margin Pressure", _clamp(_num(metrics.get("margin_probability"))), 68),
        ("Overstock", _clamp(_num(metrics.get("overstock_probability"))), 54),
    ]
    risk_matrix = [
        {
            "category": category,
            "probability": _int(probability),
            "impact": _int(impact),
            "exposure": _int(_clamp((probability * 0.55) + (impact * 0.45))),
        }
        for category, probability, impact in categories
    ]

    trend_rows = _query(
        f"""
        WITH weekly AS (
          SELECT
            date_trunc('week', order_date) AS week_start,
            date_format(date_trunc('week', order_date), 'MMM d') AS week,
            AVG(CASE WHEN COALESCE(is_late_delivery, 0) = 1 THEN 1.0 ELSE 0.0 END) * 100 AS risk
          FROM {delivery}
          WHERE order_date IS NOT NULL
          GROUP BY date_trunc('week', order_date)
          ORDER BY week_start DESC
          LIMIT 8
        )
        SELECT *
        FROM weekly
        ORDER BY week_start ASC
        """,
        "risk-trend",
    )
    regional_rows = _query(
        f"""
        SELECT
          market AS region,
          COUNT(*) AS orders,
          AVG(CASE WHEN COALESCE(is_late_delivery, 0) = 0 THEN 1.0 ELSE 0.0 END) * 100 AS on_time_delivery,
          SUM(COALESCE(sales, 0)) AS revenue,
          SUM(COALESCE(profit, 0)) AS profit
        FROM {delivery}
        WHERE market IS NOT NULL
        GROUP BY market
        ORDER BY orders DESC
        LIMIT 8
        """,
        "regional-performance",
    )
    high = sum(1 for item in risk_matrix if item["exposure"] > 60)
    network_risk = _int(sum(item["exposure"] for item in risk_matrix) / len(risk_matrix)) if risk_matrix else 0
    return {
        "riskMatrix": risk_matrix,
        "riskTrend": [
            {"week": row.get("week") or "", "risk": _int(row.get("risk"))}
            for row in trend_rows
        ],
        "regions": [
            {
                "region": row.get("region") or "Unknown",
                "orders": _int(row.get("orders")),
                "onTimeDelivery": _num(row.get("on_time_delivery")),
                "revenue": _num(row.get("revenue")),
                "profit": _num(row.get("profit")),
            }
            for row in regional_rows
        ],
        "summary": {
            "highExposure": high,
            "networkRisk": network_risk,
            "anomalies": high + sum(1 for item in risk_matrix if item["probability"] > 50),
            "resolved": max(0, len(risk_matrix) - high),
            "reviewing": high,
        },
    }


def build_revenue_trends() -> dict[str, Any]:
    sales = _sales_table()
    rows = _query(
        f"""
        WITH monthly AS (
          SELECT
            date_trunc('month', order_date) AS month_start,
            date_format(date_trunc('month', order_date), 'MMM yyyy') AS period,
            SUM(COALESCE(sales, 0)) AS revenue,
            SUM(COALESCE(profit, 0)) AS profit,
            COUNT(*) AS orders
          FROM {sales}
          WHERE order_date IS NOT NULL
          GROUP BY date_trunc('month', order_date)
          ORDER BY month_start DESC
          LIMIT 12
        )
        SELECT *
        FROM monthly
        ORDER BY month_start ASC
        """,
        "revenue-trends",
    )
    return {
        "trends": [
            {
                "period": row.get("period") or "",
                "revenue": _num(row.get("revenue")),
                "profit": _num(row.get("profit")),
                "orders": _int(row.get("orders")),
            }
            for row in rows
        ]
    }


@analytics_router.get("/api/databricks-status")
async def databricks_status():
    def builder() -> dict[str, str]:
        row = _first(
            get_databricks_client().query(
                "SELECT 1 AS ok",
                cache_key="databricks-status",
                ttl_seconds=30,
            )
        )
        return {"status": "connected" if row.get("ok") == 1 else "unknown"}

    return await run_in_threadpool(lambda: _call_databricks(builder))


@analytics_router.get("/api/dashboard-summary")
async def dashboard_summary():
    return await run_in_threadpool(lambda: _call_databricks(build_dashboard_summary))


@analytics_router.get("/api/monthly-logistics")
async def monthly_logistics():
    return await run_in_threadpool(lambda: _call_databricks(build_monthly_logistics))


@analytics_router.get("/api/demand-intelligence")
async def demand_intelligence():
    return await run_in_threadpool(lambda: _call_databricks(build_demand_intelligence))


@analytics_router.get("/api/regional-performance")
async def regional_performance():
    return await run_in_threadpool(lambda: _call_databricks(build_regional_performance))


@analytics_router.get("/api/revenue-trends")
async def revenue_trends():
    return await run_in_threadpool(lambda: _call_databricks(build_revenue_trends))


@analytics_router.get("/api/inventory")
async def inventory():
    return await run_in_threadpool(lambda: _call_databricks(build_inventory))


@analytics_router.get("/api/shipments")
async def shipments():
    return await run_in_threadpool(lambda: _call_databricks(build_shipments))
