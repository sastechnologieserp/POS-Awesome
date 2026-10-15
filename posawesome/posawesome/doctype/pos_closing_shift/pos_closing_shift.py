# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.utils import get_base_value
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    get_cashiers,
    get_pos_invoices,
    get_payments_entries,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.overview import (
    get_closing_shift_overview,
    get_payment_reconciliation_details,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import (
    make_closing_shift_from_opening,
    submit_closing_shift,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
    submit_printed_invoices,
    delete_draft_invoices,
    _set_closing_entry_invoices,
    _clear_closing_entry_invoices,
    consolidate_closing_shift_invoices,
)


class POSClosingShift(Document):
    def validate(self):
        user = frappe.get_all(
            "POS Closing Shift",
            filters={
                "user": self.user,
                "docstatus": 1,
                "pos_opening_shift": self.pos_opening_shift,
                "name": ["!=", self.name],
            },
        )

        if user:
            frappe.throw(
                _(
                    "POS Closing Shift {} against {} between selected period".format(
                        frappe.bold("already exists"), frappe.bold(self.user)
                    )
                ),
                title=_("Invalid Period"),
            )

        if frappe.db.get_value("POS Opening Shift", self.pos_opening_shift, "status") != "Open":
            frappe.throw(
                _("Selected POS Opening Shift should be open."),
                title=_("Invalid Opening Entry"),
            )
        self.update_payment_reconciliation()

    def update_payment_reconciliation(self):
        # update the difference values in Payment Reconciliation child table
        # get default precision for site
        precision = frappe.get_cached_value("System Settings", None, "currency_precision") or 3
        for d in self.payment_reconciliation:
            expected_currency = flt(d.get("expected_amount_in_currency"), precision)
            has_currency_closing = d.get("closing_amount_in_currency") not in (None, "")
            closing_currency = flt(d.get("closing_amount_in_currency"), precision)
            if d.get("currency") and has_currency_closing:
                conversion_rate = (
                    abs(flt(d.expected_amount, precision) / expected_currency)
                    if expected_currency
                    else 1
                )
                d.closing_amount = flt(closing_currency * conversion_rate, precision)
                d.difference_in_currency = closing_currency - expected_currency
            d.difference = +flt(d.closing_amount, precision) - flt(d.expected_amount, precision)

    def on_submit(self):
        opening_entry = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
        opening_entry.pos_closing_shift = self.name
        opening_entry.set_status()
        self.delete_draft_invoices()
        opening_entry.save()
        # link invoices with this closing shift so ERPNext can block edits
        _set_closing_entry_invoices(self)
        consolidate_closing_shift_invoices(self)

    def on_cancel(self):
        if frappe.db.exists("POS Opening Shift", self.pos_opening_shift):
            opening_entry = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
            if opening_entry.pos_closing_shift == self.name:
                opening_entry.pos_closing_shift = ""
                opening_entry.set_status()
                opening_entry.save()
        # remove links from invoices so they can be cancelled
        _clear_closing_entry_invoices(self)

    def delete_draft_invoices(self):
        delete_draft_invoices(self.pos_opening_shift, self.pos_profile)

    @frappe.whitelist()
    def get_payment_reconciliation_details(self):
        return get_payment_reconciliation_details(self)


@frappe.whitelist()
def get_last_closed_shift(pos_profile=None, user=None):
    """Return the most recent submitted POS Closing Shift name."""
    import json
    user = user or frappe.session.user
    if isinstance(pos_profile, str):
        try:
            parsed = json.loads(pos_profile)
            if isinstance(parsed, dict):
                pos_profile = parsed.get("name") or parsed.get("pos_profile") or pos_profile
        except Exception:
            pass
    elif isinstance(pos_profile, dict):
        pos_profile = pos_profile.get("name") or pos_profile.get("pos_profile")

    filters = {"docstatus": 1, "user": user}
    if pos_profile:
        filters["pos_profile"] = pos_profile

    rows = frappe.get_all(
        "POS Closing Shift",
        filters=filters,
        pluck="name",
        order_by="period_end_date desc, creation desc",
        limit_page_length=1,
    )
    return rows[0] if rows else None


def get_items_sold_during_shift(pos_opening_shift):
    """Get items sold during the shift with quantities and amounts."""
    invoices = frappe.get_all(
        "Sales Invoice",
        filters={
            "posa_pos_opening_shift": pos_opening_shift,
            "docstatus": 1,
        },
        fields=["name"],
    )

    items_summary = {}
    for invoice in invoices:
        invoice_doc = frappe.get_doc("Sales Invoice", invoice.name)
        for item in invoice_doc.items:
            item_key = item.item_code
            if item_key not in items_summary:
                items_summary[item_key] = {
                    "item_name": item.item_name,
                    "qty": 0,
                    "amount": 0,
                }
            items_summary[item_key]["qty"] += item.qty
            items_summary[item_key]["amount"] += item.amount

    items_list = []
    for item_code, data in items_summary.items():
        items_list.append(
            {
                "item_code": item_code,
                "item_name": data["item_name"],
                "qty": data["qty"],
                "amount": data["amount"],
            }
        )

    items_list.sort(key=lambda x: x["amount"], reverse=True)
    return items_list


def get_unpaid_invoices(pos_opening_shift):
    if not pos_opening_shift:
        return []
    return frappe.db.sql(
        """
        select name, grand_total, outstanding_amount, customer, customer_name, posting_date, docstatus
        from `tabSales Invoice`
        where posa_pos_opening_shift = %s and docstatus = 1 and outstanding_amount > 0
        """,
        (pos_opening_shift,),
        as_dict=1,
    )


def get_overdue_invoices(pos_opening_shift):
    if not pos_opening_shift:
        return []
    return frappe.db.sql(
        """
        select name, grand_total, outstanding_amount, customer, customer_name, posting_date, status, docstatus
        from `tabSales Invoice`
        where posa_pos_opening_shift = %s and docstatus = 1 and outstanding_amount > 0
        and (status = 'Overdue' or status = 'Overdue and Discounted')
        """,
        (pos_opening_shift,),
        as_dict=1,
    )


def get_sales_returns_for_shift(pos_opening_shift):
    try:
        return_sales = frappe.get_all(
            "Sales Invoice",
            filters={
                "posa_pos_opening_shift": pos_opening_shift,
                "docstatus": 1,
                "is_return": 1,
            },
            fields=["name", "customer", "grand_total", "posting_date", "posting_time", "posa_pos_opening_shift"],
        )
        return {
            "returns": return_sales,
            "returns_total": sum(abs(flt(return_inv.grand_total)) for return_inv in return_sales),
            "returns_count": len(return_sales),
        }
    except Exception:
        return {"returns": [], "returns_total": 0, "returns_count": 0}


def get_cash_movements_for_shift(pos_opening_shift):
    try:
        cash_movements = frappe.get_all(
            "POS Cash Movement",
            filters={"pos_opening_shift": pos_opening_shift, "docstatus": 1},
            fields=["movement_type", "amount", "remarks", "creation"],
        )
        pay_in_total = sum(
            flt(entry.amount) for entry in cash_movements if entry.movement_type in ("Pay In", "Receive")
        )
        pay_out_total = sum(
            flt(entry.amount) for entry in cash_movements if entry.movement_type in ("Pay Out", "Pay")
        )
        return {
            "entries": cash_movements,
            "pay_in_total": pay_in_total,
            "pay_out_total": pay_out_total,
            "total_entries": len(cash_movements),
        }
    except Exception:
        return {"entries": [], "pay_in_total": 0, "pay_out_total": 0, "total_entries": 0}


@frappe.whitelist()
def direct_print_cashier_shift_report(closing_shift_name):
    """Direct print function that generates HTML and returns it for immediate printing."""
    closing_shift_doc = frappe.get_doc("POS Closing Shift", closing_shift_name)
    company = frappe.get_doc("Company", closing_shift_doc.company)
    user = frappe.get_doc("User", closing_shift_doc.user)
    pos_profile = frappe.get_doc("POS Profile", closing_shift_doc.pos_profile)

    items_sold = get_items_sold_during_shift(closing_shift_doc.pos_opening_shift)
    unpaid_invoices = get_unpaid_invoices(closing_shift_doc.pos_opening_shift)
    overdue_invoices = get_overdue_invoices(closing_shift_doc.pos_opening_shift)
    cash_movement_data = get_cash_movements_for_shift(closing_shift_doc.pos_opening_shift)
    sales_returns_data = get_sales_returns_for_shift(closing_shift_doc.pos_opening_shift)

    returns_total = flt(getattr(closing_shift_doc, "return_sales_total", 0) or sales_returns_data["returns_total"])
    returns_count = flt(getattr(closing_shift_doc, "return_sales_count", 0) or sales_returns_data["returns_count"])
    credit_sales_total = flt(getattr(closing_shift_doc, "credit_sales_total", 0) or sum(flt(inv.outstanding_amount) for inv in unpaid_invoices))
    overdue_sales_total = flt(getattr(closing_shift_doc, "overdue_sales_total", 0) or sum(flt(inv.outstanding_amount) for inv in overdue_invoices))
    unpaid_invoices_count = len(unpaid_invoices)
    overdue_invoices_count = len(overdue_invoices)

    grand_total = flt(closing_shift_doc.grand_total or 0)
    net_total = flt(closing_shift_doc.net_total or 0)

    opening_cash_balance = 0
    cash_sales_net = 0
    cash_payment_found = False
    cash_closing_amount = 0

    cash_mode_of_payment = frappe.get_value("POS Profile", closing_shift_doc.pos_profile, "posa_cash_mode_of_payment") or "Cash"

    for payment in closing_shift_doc.payment_reconciliation:
        if payment.mode_of_payment == cash_mode_of_payment or "cash" in payment.mode_of_payment.lower():
            opening_cash_balance = flt(payment.opening_amount or 0)
            cash_sales_net = flt(payment.expected_amount or 0) - flt(payment.opening_amount or 0)
            cash_payment_found = True
            cash_closing_amount = flt(payment.closing_amount or 0)
            break

    cash_sales_total = cash_sales_net + returns_total
    total_payments = sum(
        flt(payment.expected_amount or 0) - flt(payment.opening_amount or 0)
        for payment in closing_shift_doc.payment_reconciliation
    )
    net_sales = grand_total
    gross_sales = grand_total
    total_amount = total_payments + credit_sales_total + overdue_sales_total

    pay_in_amount = flt(cash_movement_data.get("pay_in_total", 0) or 0)
    pay_out_amount = flt(cash_movement_data.get("pay_out_total", 0) or 0)
    expected_cash_in_drawer = opening_cash_balance + cash_sales_net + pay_in_amount - pay_out_amount
    cash_over_short = cash_closing_amount - expected_cash_in_drawer if cash_payment_found else 0

    report_data = {
        "closing_shift": closing_shift_doc,
        "company": company,
        "user": user,
        "pos_profile": pos_profile,
        "items_sold": items_sold,
        "unpaid_invoices": unpaid_invoices,
        "overdue_invoices": overdue_invoices,
        "petty_cash_data": cash_movement_data,
        "sales_returns_data": sales_returns_data,
        "currency": company.default_currency,
        "report_date": frappe.utils.nowdate(),
        "report_time": frappe.utils.nowtime(),
        "opening_balance": opening_cash_balance,
        "cash_sales_total": cash_sales_total,
        "credit_sales_total": credit_sales_total,
        "unpaid_invoices_count": unpaid_invoices_count,
        "overdue_sales_total": overdue_sales_total,
        "overdue_invoices_count": overdue_invoices_count,
        "total_payments": total_payments,
        "grand_total": grand_total,
        "gross_sales": gross_sales,
        "net_sales": net_sales,
        "net_total": net_total,
        "total_amount": total_amount,
        "expected_cash_in_drawer": expected_cash_in_drawer,
        "cash_over_short": cash_over_short,
        "cash_payment_found": cash_payment_found,
        "cash_closing_amount": cash_closing_amount,
        "pay_in_amount": pay_in_amount,
        "pay_out_amount": pay_out_amount,
        "returns_total": returns_total,
        "returns_count": returns_count,
        "returns_list": sales_returns_data.get("returns", []),
    }

    html_content = frappe.render_template(
        "posawesome/posawesome/doctype/pos_closing_shift/cashier_shift_report.html",
        report_data,
    )
    return html_content
