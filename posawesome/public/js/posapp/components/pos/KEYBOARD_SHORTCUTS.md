# POS Awesome Keyboard Shortcuts

This document describes the active keyboard shortcuts used in the POS screen.

## Core Shortcuts

### Help and Navigation
- **F1** - Show shortcuts help dialog
- **Esc** - Toggle item search focus (sales screen only)
- **End** - Recall today's invoices (Return/Print actions)
- **Home** - Open cash drawer

### Payment Flow
- **F5** - Open payment dialog, or submit and print when payment page is open
- **Ctrl+S** - Same behavior as F5
- **F6** - Quick cash payment, submit, and print
- **Ctrl+X** - Submit payment (payment page only)
- **Ctrl+E** - Focus discount field

### Cart and Item Management
- **/** - Edit price of the first item
- **F7** - Edit quantity of the first item
- **Delete** - Remove first item from cart
- **Ctrl+Z** - Remove last added item from cart
- **Ctrl+A** - Toggle expand/collapse first item details

## Non-Keyboard Actions
- **Hold Button** - Save current invoice as draft and clear
- **Release Button** - Load previously saved draft invoices

## Behavior Notes
- F5 and Ctrl+S are context-sensitive and share the same logic:
  - Sales screen: open payment
  - Payment screen: submit and print
- Delete shortcut is ignored while typing in input/select/contenteditable fields.
- Item edit shortcuts operate on the first item in cart.

## Implementation Files
- `posawesome/public/js/posapp/components/pos/invoiceShortcuts.js`
- `posawesome/public/js/posapp/components/pos/Invoice.vue`
- `posawesome/public/js/posapp/components/pos/Pos.vue`
- `posawesome/public/js/posapp/components/pos/Payments.vue`
