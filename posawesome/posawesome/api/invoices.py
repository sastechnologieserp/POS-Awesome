# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

"""Public invoice API facade backed by `invoice_processing` modules."""

import frappe
import time
from posawesome.posawesome.api.erpnext_compat import resolve_make_sales_invoice_from_order
from posawesome.posawesome.api.tax_contracts import apply_pos_tax_inclusion_contract
from posawesome.posawesome.api.invoice_processing.utils import (
    _get_return_validity_settings,
    _build_invoice_remarks,
    _set_return_valid_upto,
    _validate_return_window,
    get_latest_rate,
    get_price_list_currency,
    get_available_currencies,
)
from posawesome.posawesome.api.invoice_processing.stock import (
    _strip_client_freebies_from_payload,
    _validate_stock_on_invoice,
    _apply_item_name_overrides,
    _deduplicate_free_items,
    _merge_duplicate_taxes,
    _auto_set_return_batches,
    _collect_stock_errors,
    _should_block,
)
from posawesome.posawesome.api.invoice_processing.creation import (
    update_invoice,
    submit_invoice,
    submit_in_background_job,
    repair_invoice_submission,
    validate_cart_items,
)
from posawesome.posawesome.api.invoice_processing.returns import (
    search_invoices_for_return,
    validate_return_items,
    get_invoice_for_return,
)
from posawesome.posawesome.api.invoice_processing.payment import _create_change_payment_entries
from posawesome.posawesome.api.invoice_processing.data import get_last_invoice_rates
from posawesome.posawesome.api.utils import log_perf_event


@frappe.whitelist()
def get_draft_invoices(
    pos_opening_shift=None,
    doctype="Sales Invoice",
    limit_page_length=0,
    company=None,
    pos_profile=None,
    cashier=None,
    is_supervisor=0,
):
    started_at = time.perf_counter()
    try:
        limit_page_length = int(limit_page_length or 0)
    except (TypeError, ValueError):
        limit_page_length = 0
    if limit_page_length < 0:
        limit_page_length = 0

    supervisor_scope = int(is_supervisor or 0)
    filters = {
        "docstatus": 0,
    }
    if supervisor_scope and company:
        filters["company"] = company
        if pos_profile:
            filters["pos_profile"] = pos_profile
        if cashier:
            filters["owner"] = cashier
    else:
        filters["posa_pos_opening_shift"] = pos_opening_shift
    if frappe.db.has_column(doctype, "posa_is_printed"):
        filters["posa_is_printed"] = 0

    invoices_list = frappe.get_list(
        doctype,
        filters=filters,
        fields=[
            "name",
            "customer",
            "customer_name",
            "posting_date",
            "posting_time",
            "grand_total",
            "currency",
            "pos_profile",
            "owner",
            "modified_by",
        ],
        limit_page_length=limit_page_length,
        order_by="modified desc",
    )
    for invoice in invoices_list:
        invoice["doctype"] = doctype
    log_perf_event(
        "get_draft_invoices",
        started_at,
        doctype=doctype,
        rows=len(invoices_list),
    )
    return invoices_list


@frappe.whitelist()
def get_draft_invoice_doc(invoice_name, doctype="Sales Invoice"):
    started_at = time.perf_counter()
    doc = frappe.get_cached_doc(doctype, invoice_name)
    log_perf_event(
        "get_draft_invoice_doc",
        started_at,
        doctype=doctype,
        invoice=invoice_name,
        items=len(getattr(doc, "items", []) or []),
    )
    return doc


@frappe.whitelist()
def delete_invoice(invoice):
    from frappe import _
    from posawesome.posawesome.api.invoice import delete_invoice_submission_ledger_entries_for_invoice

    doctype = "Sales Invoice"
    if frappe.db.exists("POS Invoice", invoice):
        doctype = "POS Invoice"
    elif not frappe.db.exists("Sales Invoice", invoice):
        frappe.throw(_("Invoice {0} does not exist").format(invoice))

    if frappe.db.has_column(doctype, "posa_is_printed") and frappe.get_value(
        doctype, invoice, "posa_is_printed"
    ):
        frappe.throw(_("This invoice {0} cannot be deleted").format(invoice))

    frappe.delete_doc(doctype, invoice, force=1)
    delete_invoice_submission_ledger_entries_for_invoice(doctype, invoice)
    return _("Invoice {0} Deleted").format(invoice)


@frappe.whitelist()
def fetch_exchange_rate_pair(from_currency, to_currency):
    """Return exchange rate payload expected by POS multi-currency UI."""

    if not from_currency or not to_currency:
        frappe.throw("from_currency and to_currency are required")

    if from_currency == to_currency:
        from frappe.utils import nowdate

        return {
            "exchange_rate": 1,
            "date": nowdate(),
        }

    exchange_rate, rate_date = get_latest_rate(from_currency, to_currency)
    return {
        "exchange_rate": exchange_rate,
        "date": rate_date,
    }


@frappe.whitelist()
def create_sales_invoice_from_order(sales_order):
    """Backward-compatible facade for legacy frontend method path."""

    if not sales_order:
        frappe.throw("sales_order is required")

    if not frappe.db.exists("Sales Order", sales_order):
        frappe.throw(f"Sales Order {sales_order} does not exist")

    sales_order_doc = frappe.get_doc("Sales Order", sales_order)
    invoice_doc = resolve_make_sales_invoice_from_order()(sales_order)
    invoice_doc.flags.ignore_permissions = True
    invoice_doc.run_method("set_missing_values")
    apply_pos_tax_inclusion_contract(invoice_doc, source_doc=sales_order_doc, recalculate=False)
    invoice_doc.run_method("calculate_taxes_and_totals")
    return invoice_doc


@frappe.whitelist()
def delete_sales_invoice(sales_invoice):
    """Backward-compatible facade for legacy frontend method path."""

    if not sales_invoice:
        frappe.throw("sales_invoice is required")

    if frappe.db.exists("Sales Invoice", sales_invoice):
        frappe.delete_doc("Sales Invoice", sales_invoice, force=1)
    return True


@frappe.whitelist()
def update_invoice_from_order(data):
    """Backward-compatible facade used by order-to-invoice flow."""

    return update_invoice(data)


@frappe.whitelist()
def open_cash_drawer():
    """
    Open the cash drawer by sending a minimal receipt format
    This prevents long page issues by using controlled dimensions
    """
    try:
        # Get current user's POS profile
        user = frappe.session.user
        pos_profiles = frappe.get_all("POS Profile", fields=["name"])
        
        if not pos_profiles:
            return {
                "success": False, 
                "message": "No POS profiles found."
            }
        
        # Use the first available profile
        pos_profile = pos_profiles[0].name
        
        # Get or create cash drawer counter
        counter_key = f"cash_drawer_counter_{user}"
        current_counter = frappe.cache().get_value(counter_key) or 0
        new_counter = current_counter + 1
        frappe.cache().set_value(counter_key, new_counter)
        
        # Log the attempt
        frappe.logger().info(f"Opening cash drawer for user: {user}, profile: {pos_profile}, counter: {new_counter}")
        
        # Create a minimal, controlled receipt format for cash drawer
        # This prevents long page issues by using strict dimensions and minimal content
        receipt_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
                <title>Cash Drawer</title>
                <meta charset="utf-8">
                <style>
                        /* Strict page sizing to prevent long page issues */
                        @page {{
                                size: 80mm 80mm;
                                margin: 0;
                                padding: 0;
                        }}
                        
                        /* Reset all margins and padding */
                        * {{
                                margin: 0;
                                padding: 0;
                                box-sizing: border-box;
                        }}
                        
                        html, body {{
                                width: 80mm;
                                height: 80mm;
                                margin: 0;
                                padding: 0;
                                overflow: hidden;
                                font-family: 'Courier New', monospace;
                                font-size: 10px;
                                line-height: 1.2;
                                color: #000;
                                background: white;
                        }}
                        
                        /* Ensure content fits within strict dimensions */
                        .receipt-container {{
                                width: 76mm;
                                height: 76mm;
                                margin: 2mm;
                                padding: 0;
                                overflow: hidden;
                        }}
                        
                        .header {{
                                text-align: center;
                                font-weight: bold;
                                font-size: 12px;
                                margin-bottom: 3mm;
                                border-bottom: 1px solid #000;
                                padding-bottom: 2mm;
                        }}
                        
                        .content {{
                                text-align: center;
                                font-size: 10px;
                                margin: 3mm 0;
                        }}
                        
                        .counter {{
                                text-align: center;
                                font-size: 14px;
                                font-weight: bold;
                                margin: 2mm 0;
                                color: #333;
                        }}
                        
                        .small-text {{
                                text-align: center;
                                font-size: 8px;
                                margin: 2mm 0;
                                color: #666;
                                font-style: italic;
                        }}
                        
                        .timestamp {{
                                text-align: center;
                                font-size: 8px;
                                margin-top: 3mm;
                                border-top: 1px solid #000;
                                padding-top: 2mm;
                        }}
                        
                        .end-marker {{
                                text-align: center;
                                font-size: 10px;
                                margin-top: 4mm;
                                font-weight: bold;
                                color: #000;
                                border: 2px solid #000;
                                padding: 2mm;
                                border-radius: 2mm;
                        }}
                        
                        /* Print media queries to ensure consistent output */
                        @media print {{
                                html, body {{
                                        width: 80mm !important;
                                        height: 80mm !important;
                                        margin: 0 !important;
                                        padding: 0 !important;
                                        overflow: hidden !important;
                                }}
                                
                                .receipt-container {{
                                        width: 76mm !important;
                                        height: 76mm !important;
                                        margin: 2mm !important;
                                        padding: 0 !important;
                                        overflow: hidden !important;
                                }}
                                
                                /* Prevent page breaks */
                                * {{
                                        page-break-inside: avoid !important;
                                        page-break-before: avoid !important;
                                        page-break-after: avoid !important;
                                }}
                        }}
                </style>
        </head>
        <body>
                <div class="receipt-container">
                        <div class="header">CASH DRAWER OPENED</div>
                        <div class="counter">Counter: {new_counter}</div>
                        <div class="content">
                                Cash drawer has been opened<br>
                                by user: {user}<br>
                                Profile: {pos_profile}
                        </div>
                        <div class="small-text">
                                Thank you for using our POS system<br>
                                Please ensure cash drawer is properly closed<br>
                                Keep this receipt for your records
                        </div>
                        <div class="timestamp">
                                {frappe.utils.now_datetime().strftime("%Y-%m-%d %H:%M:%S")}
                        </div>
                        <div class="end-marker">END OF RECEIPT</div>
                </div>
        </body>
        </html>
        """
        
        # Return the controlled receipt content
        return {
                "success": True, 
                "message": "Cash drawer command prepared",
                "profile": pos_profile,
                "html_content": receipt_content,
                "counter": new_counter,
                "note": "This will print a controlled receipt and trigger cash drawer"
        }
        
    except Exception as e:
        frappe.logger().error(f"Failed to open cash drawer: {str(e)}")
        return {
                "success": False, 
                "message": f"Failed to open cash drawer: {str(e)}"
        }
