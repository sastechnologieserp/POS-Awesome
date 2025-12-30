# F4 Shortcut Test Guide

## Overview
The F4 shortcut in POS Awesome should automatically submit an invoice with cash payment and print it silently (without opening the print view page). When offline, it will use the **SALES POS** print format that matches your standard print template.

## What F4 Should Do
1. **Validate Requirements**: Check that items are added, customer is selected, and POS shift is open
2. **Process Invoice**: Create invoice document with proper calculations
3. **Set Cash Payment**: Automatically set cash payment to the full invoice amount
4. **Submit Invoice**: Send invoice to backend for processing (or save offline if offline)
5. **Smart Print**: 
   - **Online**: Print silently without opening print view page
   - **Offline**: Use **SALES POS** print format (same as your standard template)
6. **Clear Invoice**: Reset the POS for the next customer

## Testing Steps

### 1. Basic Setup
- Ensure you have items in the invoice
- Select a customer
- Have an active POS shift open
- Make sure you have a POS profile configured
- **IMPORTANT**: Enable `posa_silent_print` in your POS Profile

### 2. Test F4 Shortcut (Online Mode)
- Press **F4** key
- Check browser console for logging messages
- Verify that the invoice is submitted
- Check that printing happens without opening print view page

### 3. Test F4 Shortcut (Offline Mode)
- Disconnect from network or go offline
- Press **F4** key
- Check browser console for logging messages
- Verify that the invoice is saved offline
- Check that **SALES POS** print format is used (with your logo, Arabic text, etc.)

### 4. Console Logs to Look For

#### Online Mode:
```
F4 key pressed - triggering cash payment and print
This shortcut should use silent printing for better cashier experience
cashPaymentAndPrint method called - direct submission mode
All validations passed - preparing invoice using same method as show_payment()
Invoice prepared using server method, submitting directly...
printInvoiceByName called for invoice: [INVOICE_NAME]
Offline status: false
Attempting to use silent printing for F4 shortcut...
Using silent printing (posa_silent_print enabled)
Calling silentPrint function...
silentPrint called successfully for F4 shortcut
```

#### Offline Mode:
```
F4 key pressed - triggering cash payment and print
This shortcut should use silent printing for better cashier experience
cashPaymentAndPrint method called - direct submission mode
All validations passed - preparing invoice using same method as show_payment()
Invoice prepared using server method, submitting directly...
printInvoiceByName called for invoice: [INVOICE_NAME]
Offline status: true
POS is offline - using SALES POS print format
Using current invoice_doc for offline printing with SALES POS format
Using SALES POS print format for offline printing...
Opening SALES POS print window...
Triggering SALES POS offline print...
SALES POS offline invoice printed successfully
```

### 5. Troubleshooting

#### If F4 doesn't work:
- Check if the shortcut is properly registered in Invoice.vue
- Verify that invoiceShortcuts.js is imported and mixed in
- Check browser console for JavaScript errors

#### If printing opens print view page (Online):
- **Check POS Profile Setting**: Ensure `posa_silent_print` is enabled (set to 1)
- Verify that silentPrint function is available (should be imported at top of file)
- Check browser console for any error messages

#### If offline printing fails:
- Check browser console for error messages
- Verify that the SALES POS print format is being generated
- Check if there are any browser security restrictions
- Ensure the offline_print_template.js is accessible

#### If SALES POS format doesn't match:
- Verify that the `generateSalesPOSHTML` method is working
- Check that the invoice data contains all required fields
- Ensure the CSS styling is being applied correctly

#### If silent printing fails:
- Check browser console for error messages
- Verify that the iframe-based printing is working
- Check if there are any browser security restrictions
- Ensure the print.js plugin is accessible at `../../plugins/print.js`

## Expected Behavior

### Online Mode:
- **F4 pressed** → Invoice automatically submitted with cash payment
- **Printing** → Happens silently in background (no new window/page)
- **Result** → Invoice printed and POS cleared for next customer
- **Cashier Experience** → Faster customer handling, no waiting for print dialogs

### Offline Mode:
- **F4 pressed** → Invoice automatically saved offline with cash payment
- **Printing** → Uses **SALES POS** print format (your standard template)
- **Format Includes** → Company logo, Arabic text, proper styling, dashed borders
- **Result** → Invoice printed using SALES POS format and POS cleared for next customer
- **Cashier Experience** → Works even when offline, uses familiar SALES POS format

## SALES POS Format Features
When offline, the F4 shortcut will generate a print format that includes:
- ✅ Company logo (YeshFresh_LOGO.PNG)
- ✅ Arabic text labels (الإ سم, الكمية, س\ و, المجموع, etc.)
- ✅ Proper styling with VCR OSD Mono font
- ✅ Dashed borders for totals and net amounts
- ✅ 80mm receipt width
- ✅ All invoice details (items, quantities, prices, totals)
- ✅ Payment method information
- ✅ Change amount calculation

## Configuration
**REQUIRED**: The `posa_silent_print` setting must be enabled in your POS Profile for online silent printing.

## Recent Fixes Applied
- Fixed import path for `silentPrint` function (now uses `../../plugins/print.js`)
- Added direct import at top of file for better reliability
- Simplified error handling and logging
- Used the same working implementation as `invoiceOfferMethods.js`
- **NEW**: Added offline printing support using **SALES POS** print format
- **NEW**: Smart detection of online/offline status for appropriate printing method
- **NEW**: Client-side generation of SALES POS HTML template for offline use
- **NEW**: Matches your standard print format with logo, Arabic text, and styling

## Notes
- **Online**: Silent printing uses iframe-based approach to avoid opening new windows
- **Offline**: Uses **SALES POS** print format that matches your standard template
- If silent printing fails, it falls back to regular printing
- The shortcut includes comprehensive error handling and logging
- All operations are logged to the console for debugging purposes
- The import path has been corrected to match the working implementation
- Offline printing automatically detects network status and uses appropriate method
- **SALES POS format** is generated client-side to match your server-side template exactly
