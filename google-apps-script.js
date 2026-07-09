/*
  Tinytech Bill Generator - Google Apps Script

  Setup instructions:
  1. This script is configured to save bills into this Google Sheet:
     https://docs.google.com/spreadsheets/d/1Dk5enWhdwizsDpuWxW73cMZzSnaknNks4WPHmuJb-Xk/edit
  2. Bills are saved into the first sheet/tab in that spreadsheet.
  3. Add these column headers manually:
     Timestamp, Order Number, Order Date, Customer Name, Customer Phone,
     Customer Email, Billing Address, Shipping Address, City, Area,
     Vendor, Payment Method, Shipping Type, Warranty Period, Product Details,
     Subtotal, Shipping Charge, Total Amount
  4. Open Extensions > Apps Script.
  5. Paste this Google Apps Script code.
  6. Select Deploy > New deployment.
  7. Select Web App.
  8. Set Execute as: Me.
  9. Set Who has access: Anyone.
  10. Copy the Web App URL.
  11. Paste the URL inside script.js in this variable:
      const GOOGLE_SHEET_WEB_APP_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
  12. After editing this Apps Script later, use Deploy > Manage deployments,
      edit the web app, select New version, and deploy again.

  Note:
  - The script writes to the first sheet/tab in the configured spreadsheet.
  - The script will add/fix the header row automatically.
  - If the same Order Number already exists, the save is rejected.
  - Search requests return the matching Order Number row.
  - Delete requests remove the matching Order Number row.
*/

const BILL_HEADERS = [
  "Timestamp",
  "Order Number",
  "Order Date",
  "Customer Name",
  "Customer Phone",
  "Customer Email",
  "Billing Address",
  "Shipping Address",
  "City",
  "Area",
  "Vendor",
  "Payment Method",
  "Shipping Type",
  "Warranty Period",
  "Product Details",
  "Subtotal",
  "Shipping Charge",
  "Total Amount"
];

// Bills will always be saved to this exact Google Sheet.
const SPREADSHEET_ID = "1Dk5enWhdwizsDpuWxW73cMZzSnaknNks4WPHmuJb-Xk";

function doPost(e) {
  try {
    const sheet = getBillsSheet();
    const data = JSON.parse(e.postData.contents);
    const action = data.action || "save";

    if (action === "delete") {
      const deleted = deleteOrderRow(sheet, data.orderNumber);

      return ContentService
        .createTextOutput(JSON.stringify({ status: "success", deleted }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const row = [
      new Date(),
      data.orderNumber,
      data.orderDate,
      data.customerName,
      data.customerPhone,
      data.customerEmail,
      data.billingAddress,
      data.shippingAddress,
      data.city,
      data.area,
      data.vendorName,
      data.paymentMethod,
      data.shippingType,
      data.warrantyPeriod,
      data.productDetails,
      data.subtotal,
      data.shippingCharge,
      data.totalAmount
    ];

    const existingRow = findOrderRow(sheet, data.orderNumber);

    if (existingRow > 1) {
      return ContentService
        .createTextOutput(JSON.stringify({
          status: "error",
          message: "Order Number already exists. Please use a unique Order ID."
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    sheet.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;
    const sheet = getBillsSheet();

    if (action === "checkOrder") {
      const exists = findOrderRow(sheet, e.parameter.orderNumber) > 1;

      return createResponse(e, {
        status: "success",
        exists,
        sheetName: sheet.getName()
      });
    }

    if (action === "getBill") {
      const bill = getBillFromSheet(sheet, e.parameter.orderNumber);

      return createResponse(e, {
        status: "success",
        exists: Boolean(bill),
        bill,
        sheetName: sheet.getName()
      });
    }

    if (action === "listBills") {
      return createResponse(e, {
        status: "success",
        bills: getBillsFromSheet(sheet),
        sheetName: sheet.getName()
      });
    }

    return createResponse(e, {
      status: "success",
      message: "Tinytech Bill Generator Google Sheet web app is running.",
      sheetName: sheet.getName()
    });

  } catch (error) {
    return createResponse(e, {
      status: "error",
      message: error.toString()
    });
  }
}

function getBillsSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

  if (!spreadsheet) {
    throw new Error("Could not open the configured Google Sheet. Check SPREADSHEET_ID and account permission.");
  }

  const sheet = spreadsheet.getSheets()[0];

  ensureHeaderRow(sheet);

  return sheet;
}

function ensureHeaderRow(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(BILL_HEADERS);
    return;
  }

  const lastColumn = Math.max(sheet.getLastColumn(), BILL_HEADERS.length);
  const currentHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];

  // If this is an older Tinytech sheet, insert Vendor before Payment Method.
  if (currentHeaders[10] === "Payment Method") {
    sheet.insertColumnBefore(11);
  }

  const updatedLastColumn = Math.max(sheet.getLastColumn(), BILL_HEADERS.length);
  const updatedHeaders = sheet.getRange(1, 1, 1, updatedLastColumn).getValues()[0];

  // If this is an older Tinytech sheet, insert Warranty Period before Product Details.
  if (updatedHeaders[13] === "Product Details") {
    sheet.insertColumnBefore(14);
  }

  sheet.getRange(1, 1, 1, BILL_HEADERS.length).setValues([BILL_HEADERS]);
}

function findOrderRow(sheet, orderNumber) {
  if (!orderNumber || sheet.getLastRow() < 2) {
    return -1;
  }

  const orderNumbers = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  const normalizedOrderNumber = String(orderNumber).trim().toLowerCase();

  for (let index = 0; index < orderNumbers.length; index += 1) {
    const savedOrderNumber = String(orderNumbers[index][0]).trim().toLowerCase();

    if (savedOrderNumber === normalizedOrderNumber) {
      return index + 2;
    }
  }

  return -1;
}

function deleteOrderRow(sheet, orderNumber) {
  const rowNumber = findOrderRow(sheet, orderNumber);

  if (rowNumber > 1) {
    sheet.deleteRow(rowNumber);
    return true;
  }

  return false;
}

function getBillFromSheet(sheet, orderNumber) {
  const rowNumber = findOrderRow(sheet, orderNumber);

  if (rowNumber < 2) {
    return null;
  }

  const row = sheet.getRange(rowNumber, 1, 1, BILL_HEADERS.length).getValues()[0];

  return rowToBillData(row);
}

function getBillsFromSheet(sheet) {
  if (sheet.getLastRow() < 2) {
    return [];
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, BILL_HEADERS.length).getValues();

  return values
    .filter((row) => row[1])
    .map(rowToBillData);
}

function rowToBillData(row) {
  return {
    savedAt: row[0],
    orderNumber: row[1],
    orderDate: formatSheetDate(row[2]),
    customerName: row[3],
    customerPhone: row[4],
    customerEmail: row[5],
    billingAddress: row[6],
    shippingAddress: row[7],
    city: row[8],
    area: row[9],
    vendorName: row[10],
    paymentMethod: row[11],
    shippingType: row[12],
    warrantyPeriod: row[13],
    productDetails: row[14],
    subtotal: row[15],
    shippingCharge: row[16],
    totalAmount: row[17]
  };
}

function formatSheetDate(value) {
  if (!value) {
    return "";
  }

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  return String(value);
}

function createResponse(e, payload) {
  const callback = e && e.parameter && e.parameter.callback;

  if (callback) {
    validateCallbackName(callback);

    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(payload) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function validateCallbackName(callback) {
  const validCallbackPattern = /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/;

  if (!validCallbackPattern.test(callback)) {
    throw new Error("Invalid callback name.");
  }
}
