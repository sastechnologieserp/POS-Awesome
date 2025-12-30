# POS Awesome Keyboard Shortcuts

This document describes the keyboard shortcuts available in POS Awesome.

## General Shortcuts

### Help and Information
- **F1** - Show comprehensive shortcuts help dialog
  - Displays all available shortcuts organized by category
  - Includes pro tips and usage recommendations
  - Option to print shortcuts for reference

### Payment and Invoice Management
- **F4** - Open payment dialog
- **Ctrl+X** - Submit payment (when in payment screen)
- **Ctrl+D** - Delete first item from invoice
- **Ctrl+A** - Toggle expand/collapse first item details
- **Ctrl+E** - Focus discount field

### New Shortcuts (Added)

#### Cash Drawer Control
- **Home** - Open cash drawer
  - Sends a command to the receipt printer to open the cash drawer
  - Requires proper printer setup with ESC/POS commands

#### Invoice Recall
- **End** - Recall today's invoices
  - Shows a dialog with all invoices from today
  - Each invoice shows two buttons:
    - **Return** - Loads the invoice back into the current session
    - **Print** - Prints the invoice directly
  - Useful for reprinting or modifying today's invoices

#### Quick Cash Payment
- **F6** - Cash payment and print
  - Automatically sets cash as the payment method
  - Sets the payment amount to the full invoice total
  - Submits the invoice and prints it automatically
  - Requires items to be added and customer to be selected

#### Item Editing
- **/** (Forward Slash) - Edit price
  - Focuses on the price field of the first item
  - Useful for quick price adjustments

- **F7** - Edit quantity
  - Shows a popup dialog to change quantity of the first item
  - Useful for quick quantity adjustments

## Visual Shortcuts Button

A **"Shortcuts"** button has been added to the POS interface that:
- Shows the same comprehensive shortcuts help as F1
- Provides easy access for users who prefer clicking over keyboard shortcuts
- Located in the invoice summary section with other action buttons

## Implementation Details

### Cash Drawer
The cash drawer functionality uses a placeholder implementation that logs the command. In a real implementation, you would need to:

1. Configure your receipt printer to support ESC/POS commands
2. Modify the `open_cash_drawer()` method in `posawesome/api/invoices.py` to send actual printer commands
3. Typical ESC/POS command for cash drawer: `ESC p m t1 t2` where m=0, t1=0x19, t2=0xFA

### Invoice Recall
The invoice recall functionality:
1. Fetches all submitted invoices from today for the current company and user
2. Shows a selection dialog with invoice details and action buttons
3. **Return button**: Loads any invoice into the current session for modification
4. **Print button**: Prints the invoice directly without loading it
5. Useful for reprinting receipts or making modifications

### Quick Cash Payment (F4)
The F4 shortcut:
1. Validates that items are added and customer is selected
2. Opens the payment dialog
3. Automatically sets cash payment to the full invoice amount
4. Clears other payment methods
5. Submits the invoice and prints it automatically

### Item Editing Shortcuts
- **/** (Forward Slash): Focuses on the price field for quick price editing
- **.** (Period): Shows a popup dialog for quick quantity editing
- Both shortcuts work on the first item in the invoice
- Provides visual feedback if no items are present

### Shortcuts Help (F1)
The F1 shortcut:
1. Shows a comprehensive dialog with all available shortcuts
2. Organizes shortcuts by category (Quick Actions, Item Management, Payment & Invoice, etc.)
3. Includes pro tips and usage recommendations
4. Provides option to print shortcuts for reference
5. Also accessible via the "Shortcuts" button in the interface

## Technical Notes

- All shortcuts are registered globally when the Invoice component is mounted
- Shortcuts are properly cleaned up when components are unmounted
- Error handling is included for all operations
- User feedback is provided through toast messages
- The shortcuts work with the existing event bus system
- F4 shortcut uses a simplified approach that opens the payment dialog and then auto-configures cash payment

## Configuration

The shortcuts are implemented in:
- `posawesome/public/js/posapp/components/pos/invoiceShortcuts.js` - Shortcut definitions
- `posawesome/public/js/posapp/components/pos/Invoice.vue` - Event registration
- `posawesome/public/js/posapp/components/pos/Payments.vue` - Payment handling
- `posawesome/public/js/posapp/components/pos/InvoiceSummary.vue` - Shortcuts button
- `posawesome/posawesome/api/invoices.py` - Backend API methods

## Usage Tips

1. **F1 for Help**: Press F1 anytime to see all available shortcuts
2. **F4 for Quick Sales**: Add items, select customer, press F4 for instant cash payment and print
3. **End for Invoice Management**: Press End to see today's invoices and quickly return or reprint them
4. **/** and **.** for Quick Edits**: Use these keys to quickly edit the first item's price and quantity
5. **Home for Cash Drawer**: Press Home to open the cash drawer (requires printer setup)
6. **Shortcuts Button**: Click the "Shortcuts" button for visual access to all shortcuts

## Shortcuts Summary

| Key | Action | Category |
|-----|--------|----------|
| F1 | Show shortcuts help | Help |
| F4 | Open payment dialog | Payment & Invoice |
| F6 | Quick cash payment & print | Quick Actions |
| F7 | Edit quantity of first item | Item Management |
| Home | Open cash drawer | Quick Actions |
| End | Recall today's invoices | Quick Actions |
| / | Edit price of first item | Item Management |
| Ctrl+A | Toggle first item details | Item Management |
| Ctrl+D | Delete first item | Item Management |
| Ctrl+E | Focus discount field | Payment & Invoice |
| Ctrl+X | Submit payment | Payment & Invoice | 