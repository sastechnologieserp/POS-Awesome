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
def direct_print_cashier_shift_report(closing_shift_name):
    """
    Direct print function that generates HTML and returns it for immediate printing
    Uses the same calculation logic as make_closing_shift_from_opening
    """
    closing_shift_doc = frappe.get_doc("POS Closing Shift", closing_shift_name)
    
    # Get company and user details
    company = frappe.get_doc("Company", closing_shift_doc.company)
    user = frappe.get_doc("User", closing_shift_doc.user)
    pos_profile = frappe.get_doc("POS Profile", closing_shift_doc.pos_profile)
    
    # Get items sold during the shift
    items_sold = get_items_sold_during_shift(closing_shift_doc.pos_opening_shift)
    
    # Get unpaid invoices (credit sales) for this shift - same as make_closing_shift_from_opening
    unpaid_invoices = get_unpaid_invoices(closing_shift_doc.pos_opening_shift)
    
    # Get overdue invoices for this shift - same as make_closing_shift_from_opening
    overdue_invoices = get_overdue_invoices(closing_shift_doc.pos_opening_shift)
    
    # Get petty cash entries for this shift
    petty_cash_data = get_petty_cash_entries_for_shift(closing_shift_doc.pos_opening_shift)
    
    # Get sales returns for this shift - same as make_closing_shift_from_opening
    sales_returns_data = get_sales_returns_for_shift(closing_shift_doc.pos_opening_shift)
    
    # Calculate using the EXACT same logic as make_closing_shift_from_opening
    # Use values from closing_shift_doc fields that were set by make_closing_shift_from_opening
    returns_total = flt(closing_shift_doc.return_sales_total or 0)
    returns_count = flt(closing_shift_doc.return_sales_count or 0)
    
    # Use credit_sales_total and overdue_sales_total from closing_shift_doc (set by make_closing_shift_from_opening)
    credit_sales_total = flt(closing_shift_doc.credit_sales_total or 0)
    overdue_sales_total = flt(closing_shift_doc.overdue_sales_total or 0)
    unpaid_invoices_count = len(unpaid_invoices)
    overdue_invoices_count = len(overdue_invoices)
    
    # Use grand_total and net_total from closing_shift_doc (set by make_closing_shift_from_opening)
    grand_total = flt(closing_shift_doc.grand_total or 0)
    net_total = flt(closing_shift_doc.net_total or 0)
    
    # Calculate cash values from payment reconciliation
    opening_cash_balance = 0
    cash_sales_net = 0
    cash_payment_found = False
    cash_closing_amount = 0
    
    # Get Cash mode of payment from POS Profile
    cash_mode_of_payment = frappe.get_value("POS Profile", closing_shift_doc.pos_profile, "posa_cash_mode_of_payment")
    if not cash_mode_of_payment:
        cash_mode_of_payment = "Cash"
    
    for payment in closing_shift_doc.payment_reconciliation:
        if payment.mode_of_payment == cash_mode_of_payment or 'cash' in payment.mode_of_payment.lower():
            opening_cash_balance = flt(payment.opening_amount or 0)
            cash_sales_net = flt(payment.expected_amount or 0) - flt(payment.opening_amount or 0)
            cash_payment_found = True
            cash_closing_amount = flt(payment.closing_amount or 0)
            break
    
    # Cash sales total (gross) = NET cash + returns
    cash_sales_total = cash_sales_net + returns_total
    
    # Calculate total payments (sum of all payment modes excluding opening amounts)
    total_payments = sum(flt(payment.expected_amount or 0) - flt(payment.opening_amount or 0) 
                         for payment in closing_shift_doc.payment_reconciliation)
    
    # Net Sales = grand_total (which already includes returns properly from make_closing_shift_from_opening)
    net_sales = grand_total
    
    # Gross Sales = Net Sales (in this context they are the same from make_closing_shift_from_opening)
    gross_sales = grand_total
    
    # Total amount = payments + credit + overdue
    total_amount = total_payments + credit_sales_total + overdue_sales_total
    
    # Pay In/Pay Out from petty cash
    pay_in_amount = flt(petty_cash_data.get('pay_in_total', 0) or 0)
    pay_out_amount = flt(petty_cash_data.get('pay_out_total', 0) or 0)
    
    # Expected cash in drawer = opening + net cash sales + pay in - pay out
    expected_cash_in_drawer = opening_cash_balance + cash_sales_net + pay_in_amount - pay_out_amount
    
    # Calculate cash over/short
    cash_over_short = cash_closing_amount - expected_cash_in_drawer if cash_payment_found else 0
    
    # Prepare data for template
    report_data = {
        "closing_shift": closing_shift_doc,
        "company": company,
        "user": user,
        "pos_profile": pos_profile,
        "items_sold": items_sold,
        "unpaid_invoices": unpaid_invoices,
        "overdue_invoices": overdue_invoices,
        "petty_cash_data": petty_cash_data,
        "sales_returns_data": sales_returns_data,
        "currency": company.default_currency,
        "report_date": frappe.utils.nowdate(),
        "report_time": frappe.utils.nowtime(),
        # Pre-calculated values from make_closing_shift_from_opening
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
        # Sales returns from closing_shift_doc (set by make_closing_shift_from_opening)
        "returns_total": returns_total,
        "returns_count": returns_count,
        "returns_list": sales_returns_data.get('returns', [])
    }
    
    # Generate HTML content
    html_content = frappe.render_template(
        "posawesome/posawesome/doctype/pos_closing_shift/cashier_shift_report.html",
        report_data
    )
    
    # Return the HTML content for direct printing
    return html_content


@frappe.whitelist()
def create_and_submit_petty_cash_entry(entry_data):
    """
    Create and submit a petty cash entry
    """
    try:
        # Parse the JSON string if it's passed as a string
        if isinstance(entry_data, str):
            import json
            entry_data = json.loads(entry_data)
        
        # Validate required fields
        if not entry_data.get("amount") or entry_data.get("amount") <= 0:
            return {
                "success": False,
                "message": "Amount must be greater than 0"
            }
        
        if not entry_data.get("note") or not entry_data.get("note").strip():
            return {
                "success": False,
                "message": "Note is required"
            }
        
        if not entry_data.get("entry_type"):
            return {
                "success": False,
                "message": "Entry type is required"
            }
        
        # Create the petty cash document
        petty_cash_doc = frappe.new_doc("Petty Cash")
        petty_cash_doc.date = entry_data.get("date")
        petty_cash_doc.entry_type = entry_data.get("entry_type")
        petty_cash_doc.pos_shift = entry_data.get("pos_shift")
        petty_cash_doc.pos_profile = entry_data.get("pos_profile")
        petty_cash_doc.amount = entry_data.get("amount")
        petty_cash_doc.note = entry_data.get("note")
        petty_cash_doc.opening_amount = entry_data.get("opening_amount", 0)
        petty_cash_doc.closing_amount = entry_data.get("closing_amount", 0)
        
        # Insert and submit
        petty_cash_doc.insert(ignore_permissions=True)
        petty_cash_doc.submit()
        
        return {
            "success": True,
            "message": f"Petty Cash {entry_data.get('entry_type')} recorded successfully",
            "doc_name": petty_cash_doc.name
        }
        
    except Exception as e:
        return {
            "success": False,
            "message": f"Failed to record petty cash entry: {str(e)}"
        }


@frappe.whitelist()
def get_petty_cash_entries_for_shift(pos_opening_shift):
    """
    Get petty cash entries for a specific POS shift
    """
    try:
        # Get petty cash entries for the shift period
        petty_cash_entries = frappe.get_all(
            "Petty Cash",
            filters={
                "pos_shift": pos_opening_shift,
                "docstatus": 1  # Submitted entries only
            },
            fields=["entry_type", "amount", "note", "date"]
        )
        
        # Calculate totals
        pay_in_total = sum(entry.amount for entry in petty_cash_entries if entry.entry_type == "Pay In")
        pay_out_total = sum(entry.amount for entry in petty_cash_entries if entry.entry_type == "Pay Out")
        
        return {
            "entries": petty_cash_entries,
            "pay_in_total": pay_in_total,
            "pay_out_total": pay_out_total
        }
    except Exception as e:
        return {
            "entries": [],
            "pay_in_total": 0,
            "pay_out_total": 0
        }


def get_sales_returns_for_shift(pos_opening_shift):
    """
    Get sales returns for a specific POS shift period
    """
    try:
        return_sales = frappe.get_all(
            "Sales Invoice",
            filters={
                "posa_pos_opening_shift": pos_opening_shift,
                "docstatus": 1,
                "is_return": 1,
            },
            fields=["name", "customer", "grand_total", "posting_date", "posting_time", "posa_pos_opening_shift"]
        )
        return {
            "returns": return_sales,
            "returns_total": sum(abs(flt(return_inv.grand_total)) for return_inv in return_sales),
            "returns_count": len(return_sales)
        }
    except Exception as e:
        return {
            "returns": [],
            "returns_total": 0,
            "returns_count": 0
        }


def get_items_sold_during_shift(pos_opening_shift):
    """
    Get items sold during the shift with quantities and amounts
    """
    try:
        invoices = frappe.get_all(
            "Sales Invoice",
            filters={
                "posa_pos_opening_shift": pos_opening_shift,
                "docstatus": 1,
            },
            fields=["name"]
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
                        "amount": 0
                    }
                items_summary[item_key]["qty"] += item.qty
                items_summary[item_key]["amount"] += item.amount
        
        items_list = []
        for item_code, data in items_summary.items():
            items_list.append({
                "item_code": item_code,
                "item_name": data["item_name"],
                "qty": data["qty"],
                "amount": data["amount"]
            })
        items_list.sort(key=lambda x: x["amount"], reverse=True)
        return items_list
    except Exception as e:
        return []


def get_unpaid_invoices(pos_opening_shift):
    """
    Get unpaid invoices (credit sales) for this shift
    """
    try:
        return frappe.get_all(
            "Sales Invoice",
            filters={
                "posa_pos_opening_shift": pos_opening_shift,
                "docstatus": 1,
                "outstanding_amount": [">", 0]
            },
            fields=["name", "customer", "grand_total", "outstanding_amount"]
        )
    except Exception as e:
        return []


def get_overdue_invoices(pos_opening_shift):
    """
    Get overdue invoices for this shift
    """
    try:
        return frappe.get_all(
            "Sales Invoice",
            filters={
                "posa_pos_opening_shift": pos_opening_shift,
                "docstatus": 1,
                "outstanding_amount": [">", 0],
                "due_date": ["<", frappe.utils.today()]
            },
            fields=["name", "customer", "grand_total", "outstanding_amount"]
        )
    except Exception as e:
        return []
