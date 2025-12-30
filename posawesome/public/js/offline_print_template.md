# Offline Print Template Documentation

## Overview

The offline print template has been improved to provide a more professional and configurable printing experience that closely matches the online Point of Sale format. It now supports custom print formats including the "POS Print" format with Arabic text and specific styling.

## Key Improvements

1. **Better Formatting**: Matches the online "Point of Sale" print format with proper styling and layout
2. **Company Information**: Displays company name and POS number at the top
3. **Currency Formatting**: Proper currency formatting for all monetary values
4. **Date Formatting**: Improved date display
5. **Configurable**: Supports custom print formats and POS profile configuration
6. **Custom POS Print Format**: Special support for "POS Print" format with Arabic text and company logo

## Usage

### Basic Usage

```javascript
import generateOfflineInvoiceHTML from './offline_print_template';

// Basic usage with invoice only
const html = generateOfflineInvoiceHTML(invoice);

// With POS profile for better formatting
const html = generateOfflineInvoiceHTML(invoice, posProfile);
```

### Custom Format Usage

```javascript
// Custom print format function
const customFormat = (invoice, posProfile) => {
  return `
    <html>
      <head><title>Custom Receipt</title></head>
      <body>
        <h1>${invoice.customer_name}</h1>
        <p>Total: ${invoice.grand_total}</p>
      </body>
    </html>
  `;
};

// Use custom format
const html = generateOfflineInvoiceHTML(invoice, posProfile, customFormat);
```

## POS Print Format

The system now includes special support for the "POS Print" format, which includes:

- **Company Logo**: Displays the YeshFresh logo
- **Arabic Text**: Bilingual labels (English/Arabic)
- **Custom Styling**: VCR OSD Mono font and specific layout
- **Barcode Support**: Displays item barcodes
- **Payment Methods**: Shows payment method information
- **Professional Layout**: 80mm width optimized for thermal printers

### Configuration

To use the POS Print format:

1. **Set Print Format in POS Profile**: 
   - Go to your POS Profile settings
   - Set the "Print Format" field to "POS Print"
   - Save the profile

2. **Automatic Detection**: The system will automatically detect when "POS Print" is configured and use the custom format for offline printing.

### POS Print Format Features

- **Company Branding**: YeshFresh logo and company information
- **Bilingual Labels**: English and Arabic text for better customer service
- **Item Details**: Shows item name, barcode, quantity, unit price, and amount
- **Totals Section**: Clear breakdown of totals, discounts, and change
- **Payment Information**: Displays payment methods used
- **Professional Styling**: Dashed borders and proper spacing

## Template Features

### Styling
- Monospace font for better alignment
- 4-inch width optimized for thermal printers
- Proper spacing and margins
- Print media queries for consistent printing

### Information Displayed
- Company name and POS number
- Customer information (name, mobile)
- Date and time
- Receipt number and status
- Item details with quantities and prices
- Tax breakdown
- Discounts and change amounts
- Terms and conditions (if configured)

### Currency Formatting
- All monetary values are properly formatted
- Supports different currencies
- Handles null/undefined values gracefully

## Integration with POS Profile

The template now accepts a POS profile object that provides:
- Company information
- Letter head settings
- Terms and conditions
- Print format preferences
- **Custom print format selection**

## Customization

### Adding Custom Fields

You can extend the template by modifying the `generateOfflineInvoiceHTML` function:

```javascript
// Add custom fields to the template
const customFields = `
  <p><b>Custom Field:</b> ${invoice.custom_field || ''}</p>
`;

// Insert into the appropriate section of the template
```

### Custom Styling

Modify the CSS in the template to match your requirements:

```css
.print-format {
  width: 4in;  /* Adjust width as needed */
  padding: 0.25in;
  min-height: 8in;
}
```

### Adding New Print Formats

To add support for additional print formats:

```javascript
// In the main function, add a new condition
if (printFormat === "Your Custom Format") {
  return generateYourCustomFormat(invoice, posProfile);
}

// Then create the corresponding function
function generateYourCustomFormat(invoice, posProfile) {
  // Your custom format implementation
  return html;
}
```

## Troubleshooting

### Common Issues

1. **Print not appearing**: Ensure the print window is focused before calling `win.print()`
2. **Formatting issues**: Check that the invoice object contains all required fields
3. **Currency not displaying**: Verify the currency field is present in the invoice object
4. **POS Print format not working**: Ensure the print format is set to "POS Print" in your POS Profile

### Debug Mode

Add console logging to debug template generation:

```javascript
console.log('Invoice data:', invoice);
console.log('POS Profile:', posProfile);
console.log('Print Format:', posProfile?.print_format);
const html = generateOfflineInvoiceHTML(invoice, posProfile);
console.log('Generated HTML:', html);
```

## Migration from Old Format

The new template is backward compatible. Existing code will continue to work, but you can enhance it by:

1. Passing the POS profile object
2. Using custom formats for specialized requirements
3. Leveraging the improved styling and formatting
4. Configuring the POS Print format in your POS Profile

## Future Enhancements

Potential improvements for future versions:
- Support for multiple print formats
- Dynamic template loading
- Print preview functionality
- Barcode/QR code support
- Multi-language support
- Custom logo configuration
- Template builder interface
