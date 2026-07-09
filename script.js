// Tinytech Bill Generator
// Replace this URL after deploying your Google Apps Script web app.
const GOOGLE_SHEET_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwNKia8LFgoNnaPOL9ZfqPPXo8357QvEPdvcdgftH5i0jfppzXLT8UkJM3ENY7pT01l/exec";
// Local settings used by the app. The storage key controls where saved bills live in this browser.
const STORAGE_KEY = "tinytech_saved_bills";
const DEFAULT_BUSINESS_EMAIL = "tinytechbd25@gmail.com";
const DEFAULT_BUSINESS_PHONE = "01825-550651";
const DEFAULT_BUSINESS_WEBSITE = "tinytechbd.com";
const DEFAULT_BUSINESS_ADDRESS =
  "60/1, Green Road, Dhaka - 1205, Bangladesh";
const DEFAULT_LOGO_SRC = "tinytech-logo.png?v=3";

let currentBill = null;
let testSheetBtn = null;

const form = document.getElementById("billForm");
const productRows = document.getElementById("productRows");
const messageArea = document.getElementById("messageArea");
const billPreview = document.getElementById("billPreview");
const savedBillsList = document.getElementById("savedBillsList");
const saveBillBtn = document.getElementById("saveBillBtn");

document.addEventListener("DOMContentLoaded", initializeApp);

// Set up the default date, first product row, saved bill list, and button events.
function initializeApp() {
  setTodayAsDefaultDate();
  document.getElementById("orderNumber").value = getNextOrderNumber();
  addProductRow();
  refreshSavedBills();
  bindEvents();
}

function bindEvents() {
  document.getElementById("addProductBtn").addEventListener("click", () => addProductRow());
  document.getElementById("generateBillBtn").addEventListener("click", handleGenerateBill);
  document.getElementById("saveBillBtn").addEventListener("click", handleSaveBill);
  testSheetBtn = document.getElementById("testSheetBtn");
  testSheetBtn.addEventListener("click", handleTestSheetConnection);
  document.getElementById("printBillBtn").addEventListener("click", handlePrint);
  document.getElementById("downloadPdfBtn").addEventListener("click", handleDownloadPdf);
  document.getElementById("clearFormBtn").addEventListener("click", clearForm);
  document.getElementById("generateOrderNumberBtn").addEventListener("click", () => {
    document.getElementById("orderNumber").value = getNextOrderNumber();
  });

  document.getElementById("copyBillingAddress").addEventListener("change", handleCopyBillingToggle);
  document.getElementById("billingAddress").addEventListener("input", syncShippingAddressIfNeeded);

  productRows.addEventListener("input", handleProductInput);
  productRows.addEventListener("click", handleProductRemove);
}

function setTodayAsDefaultDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  document.getElementById("orderDate").value = `${yyyy}-${mm}-${dd}`;
}

// Product rows are created dynamically so you can add as many order items as needed.
function addProductRow(product = {}) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>
      <input type="text" class="product-name" placeholder="Product name" value="${escapeAttribute(product.name || "")}">
    </td>
    <td>
      <input type="number" class="product-qty" min="1" step="1" value="${Number(product.quantity) || 1}">
    </td>
    <td>
      <input type="number" class="product-price" min="0" step="0.01" value="${Number(product.unitPrice) || 0}">
    </td>
    <td>
      <input type="text" class="product-total" value="${formatCurrency(product.total || 0)}" readonly>
    </td>
    <td>
      <button type="button" class="button button-danger remove-product">Remove</button>
    </td>
  `;

  productRows.appendChild(row);
  updateProductRowTotal(row);
}

function handleProductInput(event) {
  if (
    event.target.classList.contains("product-qty") ||
    event.target.classList.contains("product-price")
  ) {
    updateProductRowTotal(event.target.closest("tr"));
  }
}

function handleProductRemove(event) {
  if (!event.target.classList.contains("remove-product")) {
    return;
  }

  event.target.closest("tr").remove();

  if (productRows.children.length === 0) {
    addProductRow();
  }
}

function updateProductRowTotal(row) {
  const quantity = parseNumber(row.querySelector(".product-qty").value);
  const unitPrice = parseNumber(row.querySelector(".product-price").value);
  row.querySelector(".product-total").value = formatCurrency(quantity * unitPrice);
}

function handleCopyBillingToggle() {
  const shippingAddress = document.getElementById("shippingAddress");
  const shouldCopy = document.getElementById("copyBillingAddress").checked;

  shippingAddress.readOnly = shouldCopy;
  syncShippingAddressIfNeeded();
}

function syncShippingAddressIfNeeded() {
  if (document.getElementById("copyBillingAddress").checked) {
    document.getElementById("shippingAddress").value =
      document.getElementById("billingAddress").value;
  }
}

function handleGenerateBill() {
  const result = buildBillFromForm();

  if (!result.isValid) {
    showMessages(result.errors.map((error) => ({ type: "error", text: error })));
    return;
  }

  currentBill = result.bill;
  renderBillPreview(currentBill);
  showMessages([{ type: "success", text: "Bill generated successfully." }]);
}

async function handleSaveBill() {
  const result = buildBillFromForm();

  if (!result.isValid) {
    showMessages(result.errors.map((error) => ({ type: "error", text: error })));
    return;
  }

  const bill = result.bill;
  let savedLocally = false;

  setSavingState(true);
  showMessages([{ type: "info", text: "Checking Order ID in Google Sheet..." }]);

  try {
    const orderExists = await orderNumberExistsInGoogleSheet(bill.order.number);

    if (orderExists) {
      showMessages([
        {
          type: "error",
          text: "This Order ID already exists in Google Sheet. Please use a unique Order ID."
        }
      ]);
      return;
    }

    currentBill = bill;
    renderBillPreview(currentBill);
    saveBillLocally(currentBill);
    savedLocally = true;
    renderSavedBills(getSavedBills());

    showMessages([
      { type: "success", text: "Bill saved locally." },
      { type: "info", text: "Saving to Google Sheet..." }
    ]);

    await saveBillToGoogleSheet(currentBill);
    const isConfirmed = await confirmBillInGoogleSheet(currentBill.order.number);

    if (!isConfirmed) {
      throw new Error("Google Sheet did not confirm this Order ID.");
    }

    showMessages([
      { type: "success", text: "Bill saved locally." },
      { type: "success", text: "Bill saved to Google Sheet successfully and confirmed." }
    ]);

    if (document.getElementById("clearAfterSave").checked) {
      clearForm();
      showMessages([
        { type: "success", text: "Bill saved locally." },
        { type: "success", text: "Bill saved to Google Sheet successfully and confirmed." }
      ]);
    }

    refreshSavedBills();
  } catch (error) {
    console.error(error);
    const messages = [
      { type: "error", text: `Google Sheet save failed. ${error.message}` }
    ];

    if (savedLocally) {
      messages.unshift({ type: "success", text: "Bill saved locally." });
    }

    showMessages(messages);
  } finally {
    setSavingState(false);
  }
}

async function handleTestSheetConnection() {
  setTestSheetState(true);
  showMessages([{ type: "info", text: "Testing Google Sheet connection..." }]);

  try {
    const result = await callGoogleScriptJsonp({ action: "ping" });
    showMessages([
      {
        type: "success",
        text: `${result.message || "Google Sheet connection is working."} Target tab: ${result.sheetName || "first sheet"}.`
      }
    ]);
  } catch (error) {
    console.error(error);
    showMessages([
      {
        type: "error",
        text: `${error.message} Paste the latest google-apps-script.js code into Apps Script and deploy a new version.`
      }
    ]);
  } finally {
    setTestSheetState(false);
  }
}

function handlePrint() {
  if (!prepareBillForOutput()) {
    return;
  }

  window.print();
}

async function handleDownloadPdf() {
  if (!prepareBillForOutput()) {
    return;
  }

  const downloadButton = document.getElementById("downloadPdfBtn");
  downloadButton.disabled = true;
  downloadButton.textContent = "Preparing PDF...";

  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showMessages([
        {
          type: "info",
          text: "PDF library could not load. Opening browser print instead."
        }
      ]);
      window.print();
      return;
    }

    const filename = `${sanitizeFilename(currentBill.order.number || "tinytech-invoice")}.pdf`;
    await createInvoicePdf(currentBill, filename);
    showMessages([{ type: "success", text: "PDF downloaded successfully." }]);
  } catch (error) {
    console.error(error);
    showMessages([
      {
        type: "error",
        text: "PDF download failed. Opening browser print so you can save as PDF."
      }
    ]);
    window.print();
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = "Download as PDF";
  }
}

async function createInvoicePdf(bill, filename) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const rightEdge = pageWidth - margin;
  let y = 14;

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  const logo = await loadImageForPdf(getLogoSrc());

  if (logo) {
    const logoWidth = 78;
    const logoHeight = Math.min(36, logoWidth / logo.ratio);
    doc.addImage(logo.dataUrl, logo.format, margin, y, logoWidth, logoHeight);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text("Tinytech", margin, y + 14);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(bill.business.name || "Tinytech", rightEdge, y + 8, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 99, 115);
  doc.text(bill.business.email || DEFAULT_BUSINESS_EMAIL, rightEdge, y + 15, { align: "right" });
  doc.text(bill.business.phone || DEFAULT_BUSINESS_PHONE, rightEdge, y + 21, { align: "right" });
  doc.text(bill.business.website || DEFAULT_BUSINESS_WEBSITE, rightEdge, y + 27, { align: "right" });

  y = 56;
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("New Order / Invoice", margin, y);
  doc.setFontSize(10);
  doc.text(`Order No: ${bill.order.number}`, rightEdge, y - 2, { align: "right" });
  doc.text(`Order Date: ${formatDateForDisplay(bill.order.date)}`, rightEdge, y + 5, { align: "right" });

  y += 8;
  doc.setDrawColor(216, 221, 227);
  doc.line(margin, y, rightEdge, y);

  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Order Summary", margin, y);

  y += 8;
  y = drawProductTable(doc, bill, margin, rightEdge, y);
  y = drawTotals(doc, bill, rightEdge - 74, rightEdge, y + 6);

  y += 12;
  y = drawAddressBoxes(doc, bill, margin, rightEdge, y);

  const footerY = Math.min(y + 16, pageHeight - 25);
  doc.setDrawColor(216, 221, 227);
  doc.line(margin, footerY - 8, rightEdge, footerY - 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("Thank you for shopping with Tinytech!", pageWidth / 2, footerY, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 99, 115);
  doc.text(bill.business.address || DEFAULT_BUSINESS_ADDRESS, pageWidth / 2, footerY + 7, { align: "center" });

  doc.save(filename);
}

function drawProductTable(doc, bill, left, right, y) {
  const productX = left;
  const quantityX = right - 55;
  const priceX = right;
  const tableWidth = right - left;

  function drawHeader() {
    doc.setFillColor(249, 250, 251);
    doc.rect(left, y - 6, tableWidth, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(90, 99, 115);
    doc.text("PRODUCT", productX + 3, y);
    doc.text("QUANTITY", quantityX, y, { align: "center" });
    doc.text("PRICE", priceX - 3, y, { align: "right" });
    y += 7;
    doc.setDrawColor(236, 239, 243);
    doc.line(left, y, right, y);
  }

  drawHeader();

  bill.products.forEach((product) => {
    const productLines = doc.splitTextToSize(product.name || "Product", quantityX - productX - 12);
    const rowHeight = Math.max(10, productLines.length * 5 + 5);

    if (y + rowHeight > 260) {
      doc.addPage();
      y = 18;
      drawHeader();
    }

    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(productLines, productX + 3, y);
    doc.text(formatQuantity(product.quantity), quantityX, y, { align: "center" });
    doc.text(formatPdfCurrency(product.total), priceX - 3, y, { align: "right" });
    y += rowHeight - 5;
    doc.setDrawColor(236, 239, 243);
    doc.line(left, y, right, y);
  });

  return y;
}

function drawTotals(doc, bill, left, right, y) {
  const rows = [
    ["Subtotal", formatPdfCurrency(bill.subtotal)],
    ["Shipping charge", formatPdfCurrency(bill.order.shippingCharge)],
    ["Payment method", bill.order.paymentMethod || ""],
    ["Warranty period", bill.order.warrantyPeriod || "N/A"]
  ];

  doc.setFontSize(10);

  rows.forEach(([label, value]) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90, 99, 115);
    doc.text(label, left, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(String(value), right, y, { align: "right" });
    y += 7;
  });

  doc.setDrawColor(216, 221, 227);
  doc.line(left, y - 3, right, y - 3);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Total amount", left, y + 5);
  doc.text(formatPdfCurrency(bill.totalAmount), right, y + 5, { align: "right" });

  return y + 10;
}

function drawAddressBoxes(doc, bill, left, right, y) {
  if (y > 225) {
    doc.addPage();
    y = 18;
  }

  const gap = 8;
  const boxWidth = (right - left - gap) / 2;
  const boxHeight = 50;
  const billingX = left;
  const shippingX = left + boxWidth + gap;

  drawAddressBox(doc, billingX, y, boxWidth, boxHeight, "Billing Address", [
    bill.customer.name,
    bill.customer.billingAddress,
    joinLocation(bill.customer.city, bill.customer.area),
    `Phone: ${bill.customer.phone}`,
    `Email: ${bill.customer.email || ""}`
  ]);

  drawAddressBox(doc, shippingX, y, boxWidth, boxHeight, "Shipping Address", [
    bill.customer.name,
    bill.customer.shippingAddress,
    joinLocation(bill.customer.city, bill.customer.area),
    `Delivery: ${bill.order.shippingType || ""}`
  ]);

  return y + boxHeight;
}

function drawAddressBox(doc, x, y, width, height, title, lines) {
  doc.setDrawColor(216, 221, 227);
  doc.roundedRect(x, y, width, height, 1.5, 1.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(title, x + 4, y + 7);

  let textY = y + 15;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 99, 115);

  lines.filter(Boolean).forEach((line) => {
    const wrappedLines = doc.splitTextToSize(String(line), width - 8);
    doc.text(wrappedLines, x + 4, textY);
    textY += wrappedLines.length * 4.5;
  });
}

function loadImageForPdf(src) {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");

        resolve({
          dataUrl,
          format: "PNG",
          ratio: image.naturalWidth / image.naturalHeight
        });
      } catch (error) {
        console.error(error);
        resolve(null);
      }
    };

    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function formatPdfCurrency(amount) {
  return `${Number(amount || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} BDT`;
}

function getLogoSrc() {
  return window.TINYTECH_LOGO_DATA_URL || DEFAULT_LOGO_SRC;
}

function prepareBillForOutput() {
  const result = buildBillFromForm();

  if (!result.isValid) {
    showMessages(result.errors.map((error) => ({ type: "error", text: error })));
    return false;
  }

  currentBill = result.bill;
  renderBillPreview(currentBill);
  return true;
}

function waitForImages(container) {
  const images = Array.from(container.querySelectorAll("img"));

  return Promise.all(
    images.map((image) => {
      if (image.complete) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    })
  );
}

function sanitizeFilename(value) {
  return String(value || "tinytech-invoice")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-");
}


// Read all form fields, validate them, then return one clean bill object.
function buildBillFromForm() {
  syncShippingAddressIfNeeded();

  const business = {
    name: getValue("businessName") || "Tinytech",
    email: DEFAULT_BUSINESS_EMAIL,
    phone: DEFAULT_BUSINESS_PHONE,
    website: DEFAULT_BUSINESS_WEBSITE,
    address: getValue("businessAddress") || DEFAULT_BUSINESS_ADDRESS,
    logo: DEFAULT_LOGO_SRC
  };

  const shippingChargeInput = getValue("shippingCharge");
  const order = {
    number: getValue("orderNumber"),
    date: getValue("orderDate"),
    vendorName: getValue("vendorName") || "EZ Gadgets",
    paymentMethod: getValue("paymentMethod") || "Cash on Delivery",
    shippingType: getValue("shippingType"),
    shippingCharge: parseNumber(shippingChargeInput),
    warrantyPeriod: getValue("warrantyPeriod")
  };

  const customer = {
    name: getValue("customerName"),
    phone: getValue("customerPhone"),
    email: getValue("customerEmail"),
    billingAddress: getValue("billingAddress"),
    shippingAddress: getValue("shippingAddress"),
    city: getValue("city"),
    area: getValue("area")
  };

  const products = collectProducts();
  const errors = validateBill(order, customer, products);

  if (
    shippingChargeInput === "" ||
    !Number.isFinite(Number(shippingChargeInput)) ||
    Number(shippingChargeInput) < 0
  ) {
    errors.push("Shipping charge must be a valid number.");
  }

  const subtotal = products.reduce((sum, product) => sum + product.total, 0);
  const totalAmount = subtotal + order.shippingCharge;

  return {
    isValid: errors.length === 0,
    errors,
    bill: {
      savedAt: new Date().toISOString(),
      business,
      order,
      customer,
      products,
      subtotal,
      totalAmount
    }
  };
}

function collectProducts() {
  return Array.from(productRows.querySelectorAll("tr")).map((row) => {
    const quantityInput = row.querySelector(".product-qty").value.trim();
    const unitPriceInput = row.querySelector(".product-price").value.trim();
    const quantity = parseNumber(quantityInput);
    const unitPrice = parseNumber(unitPriceInput);

    return {
      name: row.querySelector(".product-name").value.trim(),
      quantityInput,
      unitPriceInput,
      quantity,
      unitPrice,
      total: quantity * unitPrice
    };
  });
}

// These checks run before generating, saving, printing, or sending data to Google Sheets.
function validateBill(order, customer, products) {
  const errors = [];

  if (!order.number) errors.push("Order number is required.");
  if (!order.date) errors.push("Order date is required.");
  if (!customer.name) errors.push("Customer name is required.");
  if (!customer.phone) errors.push("Customer phone number is required.");
  if (products.length === 0) errors.push("At least one product is required.");

  products.forEach((product, index) => {
    const rowNumber = index + 1;
    if (!product.name) errors.push(`Product ${rowNumber}: product name cannot be empty.`);
    if (
      product.quantityInput === "" ||
      !Number.isFinite(Number(product.quantityInput)) ||
      product.quantity <= 0
    ) {
      errors.push(`Product ${rowNumber}: quantity must be greater than 0.`);
    }
    if (
      product.unitPriceInput === "" ||
      !Number.isFinite(Number(product.unitPriceInput)) ||
      product.unitPrice < 0
    ) {
      errors.push(`Product ${rowNumber}: unit price must be greater than or equal to 0.`);
    }
  });

  return errors;
}

// Build the professional invoice view from the current bill object.
function renderBillPreview(bill) {
  billPreview.className = "invoice";

  const businessName = escapeHtml(bill.business.name || "Tinytech");
  const logoMarkup = `
    <div class="invoice-logo-frame">
      <img
        src="${getLogoSrc()}"
        alt="${businessName} logo"
        class="invoice-logo"
        onerror="this.style.display='none'; this.parentElement.nextElementSibling.style.display='block';"
      >
    </div>
    <span class="invoice-logo-fallback">${businessName}</span>
  `;

  const productsMarkup = bill.products
    .map(
      (product) => `
        <tr>
          <td>${escapeHtml(product.name)}</td>
          <td>${formatQuantity(product.quantity)}</td>
          <td>${formatCurrency(product.total)}</td>
        </tr>
      `
    )
    .join("");

  billPreview.innerHTML = `
    <div class="invoice-header">
      <div class="invoice-brand">
        ${logoMarkup}
        <div class="invoice-contact">
          <h2>${businessName}</h2>
          <p>${escapeHtml(bill.business.email || "")}</p>
          <p>${escapeHtml(bill.business.phone || "")}</p>
          <p>${escapeHtml(bill.business.website || DEFAULT_BUSINESS_WEBSITE)}</p>
        </div>
      </div>
      <div class="invoice-meta">
        <h2 class="invoice-title">New Order / Invoice</h2>
        <p><strong>Order No:</strong> ${escapeHtml(bill.order.number)}</p>
        <p><strong>Order Date:</strong> ${formatDateForDisplay(bill.order.date)}</p>
      </div>
    </div>

    <section class="invoice-section">
      <h3>Order Summary</h3>
      <table class="invoice-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          ${productsMarkup}
        </tbody>
      </table>

      <div class="invoice-totals">
        <div class="invoice-totals-row">
          <span>Subtotal</span>
          <strong>${formatCurrency(bill.subtotal)}</strong>
        </div>
        <div class="invoice-totals-row">
          <span>Shipping charge</span>
          <strong>${formatCurrency(bill.order.shippingCharge)}</strong>
        </div>
        <div class="invoice-totals-row">
          <span>Payment method</span>
          <strong>${escapeHtml(bill.order.paymentMethod)}</strong>
        </div>
        <div class="invoice-totals-row">
          <span>Warranty period</span>
          <strong>${escapeHtml(bill.order.warrantyPeriod || "N/A")}</strong>
        </div>
        <div class="invoice-totals-row total">
          <span>Total amount</span>
          <strong>${formatCurrency(bill.totalAmount)}</strong>
        </div>
      </div>
    </section>

    <section class="invoice-section address-grid">
      <div class="address-box">
        <h3>Billing Address</h3>
        <p><strong>${escapeHtml(bill.customer.name)}</strong></p>
        <p>${escapeHtml(bill.customer.billingAddress)}</p>
        <p>${escapeHtml(joinLocation(bill.customer.city, bill.customer.area))}</p>
        <p>Phone: ${escapeHtml(bill.customer.phone)}</p>
        <p>Email: ${escapeHtml(bill.customer.email)}</p>
      </div>
      <div class="address-box">
        <h3>Shipping Address</h3>
        <p><strong>${escapeHtml(bill.customer.name)}</strong></p>
        <p>${escapeHtml(bill.customer.shippingAddress)}</p>
        <p>${escapeHtml(joinLocation(bill.customer.city, bill.customer.area))}</p>
        <p>Delivery: ${escapeHtml(bill.order.shippingType)}</p>
      </div>
    </section>

    <footer class="invoice-footer">
      <strong>Thank you for shopping with Tinytech!</strong>
      <p>${escapeHtml(bill.business.address || DEFAULT_BUSINESS_ADDRESS)}</p>
    </footer>
  `;
}

// Save a copy in this browser. This does not require internet access.
function saveBillLocally(bill) {
  const savedBills = getSavedBills();
  const existingIndex = savedBills.findIndex(
    (savedBill) => savedBill.order.number.toLowerCase() === bill.order.number.toLowerCase()
  );

  if (existingIndex >= 0) {
    savedBills.splice(existingIndex, 1);
  }

  savedBills.unshift(bill);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedBills));
}

// Send the same bill data to your deployed Google Apps Script web app.
async function saveBillToGoogleSheet(bill) {
  const webAppUrl = getGoogleScriptUrl();

  const response = await fetch(webAppUrl, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify(buildGoogleSheetPayload(bill))
  });

  // Apps Script does not expose a readable cross-origin response for this simple setup.
  // With no-cors, a resolved fetch means the browser sent the bill to the web app.
  return response;
}

async function deleteBillFromGoogleSheet(orderNumber) {
  const webAppUrl = getGoogleScriptUrl();

  const response = await fetch(webAppUrl, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({
      action: "delete",
      orderNumber
    })
  });

  return response;
}

async function confirmBillInGoogleSheet(orderNumber) {
  // Apps Script writes can take a moment to appear, so check a few times.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await delay(900);
    const result = await callGoogleScriptJsonp({
      action: "checkOrder",
      orderNumber
    });

    if (result.exists) {
      return true;
    }
  }

  return false;
}

async function orderNumberExistsInGoogleSheet(orderNumber) {
  const result = await callGoogleScriptJsonp({
    action: "checkOrder",
    orderNumber
  });

  return Boolean(result.exists);
}

async function confirmBillDeletedFromGoogleSheet(orderNumber) {
  // Apps Script writes can take a moment to appear, so check a few times.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await delay(900);
    const result = await callGoogleScriptJsonp({
      action: "checkOrder",
      orderNumber
    });

    if (!result.exists) {
      return true;
    }
  }

  return false;
}

function callGoogleScriptJsonp(params = {}, timeoutMs = 10000) {
  const webAppUrl = getGoogleScriptUrl();

  return new Promise((resolve, reject) => {
    const callbackName = `tinytechSheetCallback_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Google Apps Script did not respond."));
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    window[callbackName] = (result) => {
      cleanup();

      if (result && result.status === "success") {
        resolve(result);
        return;
      }

      reject(new Error((result && result.message) || "Google Apps Script returned an error."));
    };

    const url = new URL(webAppUrl);
    Object.entries({
      ...params,
      callback: callbackName,
      cacheBust: Date.now()
    }).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    script.onerror = () => {
      cleanup();
      reject(new Error("Could not load the Google Apps Script web app."));
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function getGoogleScriptUrl() {
  const webAppUrl = GOOGLE_SHEET_WEB_APP_URL.trim();

  if (
    !webAppUrl ||
    webAppUrl === "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE"
  ) {
    throw new Error("Google Apps Script web app URL is not configured.");
  }

  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(webAppUrl)) {
    throw new Error("Use the Google Apps Script Web App URL that ends with /exec.");
  }

  return webAppUrl;
}

// Match these property names with the columns used by google-apps-script.js.
function buildGoogleSheetPayload(bill) {
  return {
    action: "save",
    orderNumber: bill.order.number,
    orderDate: bill.order.date,
    customerName: bill.customer.name,
    customerPhone: bill.customer.phone,
    customerEmail: bill.customer.email,
    billingAddress: bill.customer.billingAddress,
    shippingAddress: bill.customer.shippingAddress,
    city: bill.customer.city,
    area: bill.customer.area,
    vendorName: bill.order.vendorName || "",
    paymentMethod: bill.order.paymentMethod,
    shippingType: bill.order.shippingType,
    warrantyPeriod: bill.order.warrantyPeriod || "",
    productDetails: bill.products
      .map((product) => `${product.name} x ${formatQuantity(product.quantity)} = ${formatCurrency(product.total)}`)
      .join("\n"),
    subtotal: formatCurrency(bill.subtotal),
    shippingCharge: formatCurrency(bill.order.shippingCharge),
    totalAmount: formatCurrency(bill.totalAmount)
  };
}

// Show bills saved in localStorage and attach View/Delete button actions.
async function refreshSavedBills() {
  savedBillsList.innerHTML = '<p class="empty-state">Loading saved bills...</p>';

  try {
    const savedBills = await getSavedBillsFromGoogleSheet();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedBills));
    document.getElementById("orderNumber").value = getNextOrderNumber();
    renderSavedBills(savedBills);
  } catch (error) {
    console.error(error);
    renderSavedBills(getSavedBills());
    showMessages([
      {
        type: "info",
        text: "Could not load saved bills from Google Sheet. Showing browser localStorage records."
      }
    ]);
  }
}

function renderSavedBills(savedBills = getSavedBills()) {
  if (savedBills.length === 0) {
    savedBillsList.innerHTML = '<p class="empty-state">No saved bills yet.</p>';
    return;
  }

  savedBillsList.innerHTML = savedBills
    .map(
      (bill) => `
        <article class="saved-bill-item">
          <div>
            <h3>${escapeHtml(bill.order.number)}</h3>
            <p>${escapeHtml(bill.customer.name)} · ${formatCurrency(bill.totalAmount)}</p>
            <p>${formatDateForDisplay(bill.order.date)}</p>
            <p>Warranty: ${escapeHtml(bill.order.warrantyPeriod || "N/A")}</p>
          </div>
          <div class="saved-bill-actions">
            <button type="button" class="button button-light" data-view-bill="${escapeAttribute(bill.order.number)}">View Bill</button>
            <button type="button" class="button button-danger" data-delete-bill="${escapeAttribute(bill.order.number)}">Delete Bill</button>
          </div>
        </article>
      `
    )
    .join("");

  savedBillsList.querySelectorAll("[data-view-bill]").forEach((button) => {
    button.addEventListener("click", () => viewSavedBill(button.dataset.viewBill));
  });

  savedBillsList.querySelectorAll("[data-delete-bill]").forEach((button) => {
    button.addEventListener("click", () => deleteSavedBill(button.dataset.deleteBill));
  });
}

async function getSavedBillsFromGoogleSheet() {
  const result = await callGoogleScriptJsonp({ action: "listBills" }, 15000);
  const bills = Array.isArray(result.bills) ? result.bills : [];

  return bills.map(convertSheetRowToBill).sort((a, b) => {
    return new Date(b.savedAt || 0).getTime() - new Date(a.savedAt || 0).getTime();
  });
}

function convertSheetRowToBill(row) {
  const products = parseSheetProductDetails(row.productDetails);
  const subtotal = parseCurrencyValue(row.subtotal);
  const shippingCharge = parseCurrencyValue(row.shippingCharge);
  const totalAmount = parseCurrencyValue(row.totalAmount);

  return {
    savedAt: row.savedAt || new Date().toISOString(),
    business: {
      name: "Tinytech",
      email: DEFAULT_BUSINESS_EMAIL,
      phone: DEFAULT_BUSINESS_PHONE,
      website: DEFAULT_BUSINESS_WEBSITE,
      address: DEFAULT_BUSINESS_ADDRESS,
      logo: DEFAULT_LOGO_SRC
    },
    order: {
      number: String(row.orderNumber || ""),
      date: normalizeDateInput(row.orderDate),
      vendorName: row.vendorName || "EZ Gadgets",
      paymentMethod: row.paymentMethod || "Cash on Delivery",
      shippingType: row.shippingType || "",
      shippingCharge,
      warrantyPeriod: row.warrantyPeriod || ""
    },
    customer: {
      name: row.customerName || "",
      phone: row.customerPhone || "",
      email: row.customerEmail || "",
      billingAddress: row.billingAddress || "",
      shippingAddress: row.shippingAddress || "",
      city: row.city || "",
      area: row.area || ""
    },
    products,
    subtotal,
    totalAmount
  };
}

function parseSheetProductDetails(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [
      {
        name: "Product",
        quantity: 1,
        unitPrice: 0,
        total: 0
      }
    ];
  }

  return lines.map((line) => {
    const match = line.match(/^(.*?)\s+x\s+([\d,.]+)\s+=\s+(.+)$/i);

    if (!match) {
      return {
        name: line,
        quantity: 1,
        unitPrice: 0,
        total: 0
      };
    }

    const quantity = parseCurrencyValue(match[2]) || 1;
    const total = parseCurrencyValue(match[3]);

    return {
      name: match[1].trim(),
      quantity,
      unitPrice: quantity > 0 ? total / quantity : total,
      total
    };
  });
}

function viewSavedBill(orderNumber) {
  const bill = getSavedBills().find((item) => item.order.number === orderNumber);

  if (!bill) {
    showMessages([{ type: "error", text: "Saved bill was not found." }]);
    return;
  }

  currentBill = bill;
  fillFormFromBill(bill);
  renderBillPreview(bill);
  showMessages([{ type: "success", text: "Saved bill loaded." }]);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteSavedBill(orderNumber) {
  const confirmed = window.confirm(`Delete saved bill ${orderNumber}?`);

  if (!confirmed) {
    return;
  }

  showMessages([{ type: "info", text: "Deleting bill from Google Sheet..." }]);

  try {
    await deleteBillFromGoogleSheet(orderNumber);
    const isDeleted = await confirmBillDeletedFromGoogleSheet(orderNumber);

    if (!isDeleted) {
      throw new Error("Google Sheet did not confirm this Order ID was deleted.");
    }

    const remainingBills = getSavedBills().filter((bill) => bill.order.number !== orderNumber);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remainingBills));
    refreshSavedBills();

    if (currentBill && currentBill.order.number === orderNumber) {
      currentBill = null;
    }

    showMessages([{ type: "success", text: "Saved bill deleted locally and from Google Sheet." }]);
  } catch (error) {
    console.error(error);
    showMessages([
      {
        type: "error",
        text: `Bill was not deleted locally because Google Sheet delete failed. ${error.message}`
      }
    ]);
  }
}

function fillFormFromBill(bill) {
  setValue("businessName", bill.business.name);
  setValue("businessEmail", DEFAULT_BUSINESS_EMAIL);
  setValue("businessPhone", DEFAULT_BUSINESS_PHONE);
  setValue("businessWebsite", DEFAULT_BUSINESS_WEBSITE);
  setValue("businessAddress", bill.business.address);
  setValue("orderNumber", bill.order.number);
  setValue("orderDate", bill.order.date);
  setValue("vendorName", bill.order.vendorName || "EZ Gadgets");
  setValue("paymentMethod", bill.order.paymentMethod);
  setValue("shippingType", bill.order.shippingType);
  setValue("shippingCharge", bill.order.shippingCharge);
  setValue("warrantyPeriod", bill.order.warrantyPeriod);
  setValue("customerName", bill.customer.name);
  setValue("customerPhone", bill.customer.phone);
  setValue("customerEmail", bill.customer.email);
  setValue("billingAddress", bill.customer.billingAddress);
  setValue("shippingAddress", bill.customer.shippingAddress);
  setValue("city", bill.customer.city);
  setValue("area", bill.customer.area);

  document.getElementById("copyBillingAddress").checked =
    bill.customer.billingAddress === bill.customer.shippingAddress && Boolean(bill.customer.billingAddress);
  handleCopyBillingToggle();

  productRows.innerHTML = "";
  bill.products.forEach((product) => addProductRow(product));
}

function clearForm() {
  form.reset();
  currentBill = null;
  productRows.innerHTML = "";
  document.getElementById("businessName").value = "Tinytech";
  document.getElementById("businessEmail").value = DEFAULT_BUSINESS_EMAIL;
  document.getElementById("businessPhone").value = DEFAULT_BUSINESS_PHONE;
  document.getElementById("businessWebsite").value = DEFAULT_BUSINESS_WEBSITE;
  document.getElementById("businessAddress").value = DEFAULT_BUSINESS_ADDRESS;
  document.getElementById("shippingAddress").readOnly = false;
  setTodayAsDefaultDate();
  document.getElementById("orderNumber").value = getNextOrderNumber();
  addProductRow();

  billPreview.className = "invoice invoice-empty";
  billPreview.innerHTML = `
    <h2>Tinytech invoice preview</h2>
    <p>Fill in the form and select Generate Bill to preview the final invoice.</p>
  `;
}

function getSavedBills() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (error) {
    console.error(error);
    return [];
  }
}

function getNextOrderNumber() {
  const savedBills = getSavedBills();
  const highestNumber = savedBills.reduce((highest, bill) => {
    const match = String(bill.order.number || "").match(/^TT-(\d+)$/i);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return `TT-${String(highestNumber + 1).padStart(4, "0")}`;
}

function setSavingState(isSaving) {
  saveBillBtn.disabled = isSaving;
  saveBillBtn.textContent = isSaving ? "Saving..." : "Save Bill";
}

function setTestSheetState(isTesting) {
  if (!testSheetBtn) {
    return;
  }

  testSheetBtn.disabled = isTesting;
  testSheetBtn.textContent = isTesting ? "Testing..." : "Test Sheet Connection";
}

function showMessages(messages) {
  messageArea.innerHTML = messages
    .map((message) => `<div class="message message-${message.type}">${escapeHtml(message.text)}</div>`)
    .join("");
}

function getValue(id) {
  return document.getElementById(id).value.trim();
}

function setValue(id, value) {
  document.getElementById(id).value = value || "";
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseCurrencyValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const cleanedValue = String(value || "")
    .replace(/৳/g, "")
    .replace(/BDT/gi, "")
    .replace(/,/g, "")
    .trim();
  const number = Number(cleanedValue);

  return Number.isFinite(number) ? number : 0;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function formatCurrency(amount) {
  return `${Number(amount || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}৳`;
}

function formatQuantity(quantity) {
  return Number(quantity).toLocaleString("en-BD", {
    maximumFractionDigits: 2
  });
}

function formatDateForDisplay(value) {
  if (!value) {
    return "";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-BD", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function normalizeDateInput(value) {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return String(value);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function joinLocation(city, area) {
  return [city, area].filter(Boolean).join(", ");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
