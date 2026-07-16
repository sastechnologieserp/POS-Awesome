import renderOfflineInvoiceHTML from "../../offline_print_template";

interface PrintDebugInfo {
	printFormat?: string;
	templatePath?: string;
}

interface PrintOptions {
	triggerPrint?: string | number | null;
	debugPrint?: boolean;
	selectors?: string[] | string;
	timeout?: number;
	invoiceDoc?: any;
	allowOfflineFallback?: boolean;
	shouldPrint?: boolean;
	showSessionMessage?: boolean;
	debugInfo?: PrintDebugInfo;
}

interface PrintDebugPayload {
	debugPrint: boolean;
	location?: string | null;
	online: boolean;
	triggerPrint: string | null;
	printFormat?: string | null;
	templatePath?: string | null;
	shouldPrint: boolean;
	note?: string;
}

const DEFAULT_READY_SELECTORS = ["#print-view", ".print-format"];
const DEFAULT_TIMEOUT = 10000;
const DEBUG_PRINT_PARAM = "debug_print";
const TRIGGER_PRINT_PARAM = "trigger_print";

function getWindowHref(targetWindow: Window | null | undefined) {
	try {
		return targetWindow?.location?.href || "";
	} catch {
		return "";
	}
}

function getSearchParamFromHref(href: string, param: string) {
	if (!href) return null;
	try {
		const resolved = new URL(href, window.location.origin);
		return resolved.searchParams.get(param);
	} catch {
		return null;
	}
}

function resolveTriggerPrint(
	targetWindow: Window | null | undefined,
	options: PrintOptions = {},
) {
	if (options.triggerPrint !== undefined && options.triggerPrint !== null) {
		return String(options.triggerPrint);
	}
	return getSearchParamFromHref(
		getWindowHref(targetWindow),
		TRIGGER_PRINT_PARAM,
	);
}

function resolveDebugPrint(
	targetWindow: Window | null | undefined,
	options: PrintOptions = {},
) {
	if (typeof options.debugPrint === "boolean") {
		return options.debugPrint;
	}
	const href = getWindowHref(targetWindow);
	if (href) {
		return getSearchParamFromHref(href, DEBUG_PRINT_PARAM) === "1";
	}
	return isDebugPrintEnabled();
}

function resolveOnlineStatus(targetWindow: Window | null | undefined) {
	try {
		return Boolean(targetWindow?.navigator?.onLine);
	} catch {
		return Boolean(navigator?.onLine);
	}
}

function logPrintDebug(details: PrintDebugPayload) {
	if (!details?.debugPrint) return;
	const payload: Record<string, unknown> = {
		location: details.location || null,
		online: details.online,
		trigger_print: details.triggerPrint,
		print_format: details.printFormat || null,
		template_path: details.templatePath || null,
		should_print: details.shouldPrint,
	};
	if (details.note) {
		payload.note = details.note;
	}
	console.log("[POSAwesome][Print Debug]", payload);
}

function isLoginRedirect(targetWindow: Window | null | undefined) {
	try {
		const path = targetWindow?.location?.pathname || "";
		if (path.includes("login")) return true;
		const title = targetWindow?.document?.title || "";
		if (/login|session/i.test(title)) return true;
		const loginForm = targetWindow?.document?.querySelector(
			"form[action*='login']",
		);
		return Boolean(loginForm);
	} catch {
		return false;
	}
}

function showSessionMessage(targetWindow: Window | null | undefined) {
	if (!targetWindow) return;
	try {
		const message =
			"Unable to load the online print view. Your session may have expired. Please sign in again and re-open the print view.";
		targetWindow.document.open();
		targetWindow.document.write(
			`<div style="font-family:sans-serif;padding:24px;line-height:1.5;">
				<h2 style="margin:0 0 12px;">Print view unavailable</h2>
				<p style="margin:0 0 12px;">${message}</p>
				<p style="margin:0;">Once signed in, retry from POS Awesome.</p>
			</div>`,
		);
		targetWindow.document.close();
	} catch (err) {
		console.warn("Unable to show session warning in print window", err);
	}
}

function waitForDocumentSelectors(
	targetWindow: Window | null | undefined,
	selectors: string[],
	timeout: number,
) {
	return new Promise<void>((resolve, reject) => {
		if (!targetWindow) {
			reject(new Error("No print target available"));
			return;
		}

		let doc;
		try {
			doc = targetWindow.document;
		} catch (err) {
			reject(err);
			return;
		}

		if (!doc) {
			reject(new Error("Print target has no document"));
			return;
		}

		let completed = false;
		let observer: MutationObserver | null = null;
		let interval: ReturnType<typeof setInterval> | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let handleUnload: (() => void) | null = null;

		const cleanup = () => {
			if (observer) observer.disconnect();
			if (interval) clearInterval(interval);
			if (timer) clearTimeout(timer);
			if (handleUnload) {
				try {
					targetWindow.removeEventListener(
						"beforeunload",
						handleUnload,
					);
				} catch (err) {
					console.warn(
						"Failed to remove unload handler from print target",
						err,
					);
				}
			}
		};

		const finish = (err?: unknown) => {
			if (completed) return;
			completed = true;
			cleanup();
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		};

		const isReady = () => {
			try {
				return selectors.some((selector) =>
					doc.querySelector(selector),
				);
			} catch (err) {
				console.warn("Failed to query print selector", err);
				return false;
			}
		};

		handleUnload = () => {
			finish(new Error("Print target navigated away before ready"));
		};

		if (isReady()) {
			finish();
			return;
		}

		try {
			const root = doc.body || doc.documentElement;
			if (root) {
				observer = new MutationObserver(() => {
					if (isReady()) {
						finish();
					}
				});
				observer.observe(root, { childList: true, subtree: true });
			}
		} catch (err) {
			console.warn("Failed to observe print document mutations", err);
		}

		interval = setInterval(() => {
			if (targetWindow.closed) {
				finish(new Error("Print target closed before ready"));
				return;
			}
			if (isReady()) {
				finish();
			}
		}, 200);

		timer = setTimeout(() => {
			finish(new Error("Timed out waiting for print markup"));
		}, timeout);

		try {
			targetWindow.addEventListener("beforeunload", handleUnload, {
				once: true,
			});
		} catch (err) {
			console.warn(
				"Failed to attach unload handler to print target",
				err,
			);
		}
	});
}

async function fallbackToOfflinePrint(
	invoiceDoc: any,
	existingWindow: Window | null | undefined,
	options: PrintOptions = {},
) {
	if (!invoiceDoc) {
		return false;
	}

	try {
		const html = await renderOfflineInvoiceHTML(invoiceDoc);
		if (!html) {
			return false;
		}

		let target: Window | null =
			existingWindow && !existingWindow.closed ? existingWindow : null;
		if (target) {
			try {
				target.document.open();
			} catch (err) {
				console.warn(
					"Failed to reuse print window for offline fallback",
					err,
				);
				target = null;
			}
		}

		if (!target) {
			target = window.open("", "_blank");
			if (!target) {
				return false;
			}
			target.document.open();
		}

		target.document.write(html);
		target.document.close();
		const shouldPrint = options.shouldPrint ?? true;
		logPrintDebug({
			debugPrint: resolveDebugPrint(target, options),
			location: getWindowHref(target),
			online: resolveOnlineStatus(target),
			triggerPrint: resolveTriggerPrint(target, options),
			printFormat: options?.debugInfo?.printFormat,
			templatePath: "offline-fallback",
			shouldPrint,
		});
		if (shouldPrint) {
			target.focus();
			target.print();
		}
		return true;
	} catch (err) {
		console.error("Offline print fallback failed", err);
		return false;
	}
}

async function ensureReadyAndPrint(
	targetWindow: Window | null | undefined,
	options: PrintOptions = {},
) {
	if (!targetWindow) {
		return;
	}

	const {
		selectors = DEFAULT_READY_SELECTORS,
		timeout = DEFAULT_TIMEOUT,
		invoiceDoc = null,
		allowOfflineFallback = true,
		shouldPrint = true,
	} = options;

	const readySelectors = Array.isArray(selectors)
		? selectors.filter(Boolean)
		: [selectors].filter(Boolean);
	const resolvedDebugPrint = resolveDebugPrint(targetWindow, options);
	const resolvedOnline = resolveOnlineStatus(targetWindow);
	const resolvePrintState = () => {
		const triggerPrintValue = resolveTriggerPrint(targetWindow, options);
		return {
			triggerPrintValue,
			resolvedShouldPrint: shouldPrint && triggerPrintValue === "1",
		};
	};
	const initialPrintState = resolvePrintState();

	// Benchmark: avoid unnecessary print calls unless trigger_print is explicitly "1" for Android reliability.
	logPrintDebug({
		debugPrint: resolvedDebugPrint,
		location: getWindowHref(targetWindow),
		online: resolvedOnline,
		triggerPrint: initialPrintState.triggerPrintValue,
		printFormat: options?.debugInfo?.printFormat,
		templatePath: "online-printview",
		shouldPrint: initialPrintState.resolvedShouldPrint,
	});

	try {
		await waitForDocumentSelectors(
			targetWindow,
			readySelectors.length ? readySelectors : DEFAULT_READY_SELECTORS,
			timeout,
		);
		const { triggerPrintValue, resolvedShouldPrint } = resolvePrintState();
		logPrintDebug({
			debugPrint: resolvedDebugPrint,
			location: getWindowHref(targetWindow),
			online: resolvedOnline,
			triggerPrint: triggerPrintValue,
			printFormat: options?.debugInfo?.printFormat,
			templatePath: "online-printview",
			shouldPrint: resolvedShouldPrint,
			note: "Print target ready",
		});
		if (resolvedShouldPrint) {
			targetWindow.focus();
			targetWindow.print();
		}
	} catch (err) {
		console.warn("Print readiness check failed", err);
		const wantsSessionMessage = options.showSessionMessage !== false;
		const { triggerPrintValue, resolvedShouldPrint } = resolvePrintState();
		if (wantsSessionMessage && isLoginRedirect(targetWindow)) {
			logPrintDebug({
				debugPrint: resolvedDebugPrint,
				location: getWindowHref(targetWindow),
				online: resolvedOnline,
				triggerPrint: triggerPrintValue,
				printFormat: options?.debugInfo?.printFormat,
				templatePath: "login-redirect",
				shouldPrint: resolvedShouldPrint,
				note: "Login redirect detected",
			});
			showSessionMessage(targetWindow);
			return;
		}
		let usedFallback = false;
		if (allowOfflineFallback && invoiceDoc) {
			usedFallback = await fallbackToOfflinePrint(
				invoiceDoc,
				targetWindow,
				{
					...options,
					shouldPrint: resolvedShouldPrint,
				},
			);
		}
		if (!usedFallback && resolvedShouldPrint) {
			try {
				targetWindow.focus();
				targetWindow.print();
			} catch (printErr) {
				console.error(
					"Printing failed after readiness check error",
					printErr,
				);
			}
		}
	}
}

export function watchPrintWindow(
	printWindow: Window | null | undefined,
	options: PrintOptions = {},
) {
	if (!printWindow) {
		return;
	}

	const handleLoad = () => {
		ensureReadyAndPrint(printWindow, options);
	};

	try {
		const doc = printWindow.document;
		if (doc?.readyState === "complete") {
			handleLoad();
		} else {
			printWindow.addEventListener("load", handleLoad, { once: true });
		}
	} catch (err) {
		console.warn("Unable to attach load handler to print window", err);
		setTimeout(() => ensureReadyAndPrint(printWindow, options), 0);
	}
}

export function silentPrint(url: string, options: PrintOptions = {}) {
	if (!url) return;
	try {
		const iframe = document.createElement("iframe");
		iframe.style.position = "fixed";
		iframe.style.right = "0";
		iframe.style.bottom = "0";
		iframe.style.width = "0";
		iframe.style.height = "0";
		iframe.style.border = "0";
		iframe.onload = () => {
			const contentWindow = iframe.contentWindow;
			const cleanup = () => setTimeout(() => iframe.remove(), 1000);
			Promise.resolve(
				ensureReadyAndPrint(contentWindow, options),
			).finally(cleanup);
		};
		iframe.src = url;
		document.body.appendChild(iframe);
	} catch (err) {
		console.error("Silent print failed, falling back to new window", err);
		const win = window.open(url, "_blank");
		if (win) {
			watchPrintWindow(win, options);
		}
	}
}

export function isDebugPrintEnabled(
	sourceWindow: Window | null | undefined = window,
) {
	try {
		const href = sourceWindow?.location?.href || "";
		return getSearchParamFromHref(href, DEBUG_PRINT_PARAM) === "1";
	} catch {
		return false;
	}
}

export function appendDebugPrintParam(
	url: string,
	debugEnabled = isDebugPrintEnabled(),
) {
	if (!url || !debugEnabled) {
		return url;
	}
	try {
		const resolved = new URL(url, window.location.origin);
		resolved.searchParams.set(DEBUG_PRINT_PARAM, "1");
		return resolved.toString();
	} catch {
		return url;
	}
}

declare const frappe: any;

export async function prefetchPrintTemplate(posProfile: any) {
	if (typeof navigator !== "undefined" && !navigator.onLine) return;
	if (!posProfile) return;

	const printFormat = posProfile.print_format_for_online || posProfile.print_format || "Standard";
	const noLetterhead = posProfile.letter_head ? 0 : 1;

	// Check if already cached
	const cachedHtml = localStorage.getItem(`posa_print_template_html_${printFormat}`);
	const cachedDoc = localStorage.getItem(`posa_print_template_doc_${printFormat}`);
	if (cachedHtml && cachedDoc) {
		console.log(`Print template for ${printFormat} is already cached.`);
		return;
	}

	console.log(`Pre-fetching print template for format: ${printFormat}`);
	try {
		// 1. Get the latest submitted Sales Invoice
		const response = await new Promise<any>((resolve, reject) => {
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Sales Invoice",
					filters: { docstatus: 1, company: posProfile.company },
					fields: ["name"],
					limit_page_length: 1,
					order_by: "creation desc",
				},
				callback: (r: any) => {
					if (r.exc) reject(r.exc);
					else resolve(r);
				}
			});
		});

		if (!response.message || !response.message.length) {
			console.log("No submitted Sales Invoices found to use as print template.");
			return;
		}

		const invoiceName = response.message[0].name;

		// 2. Fetch the invoice document details
		const docResponse = await new Promise<any>((resolve, reject) => {
			frappe.call({
				method: "frappe.client.get",
				args: {
					doctype: "Sales Invoice",
					name: invoiceName,
				},
				callback: (r: any) => {
					if (r.exc) reject(r.exc);
					else resolve(r);
				}
			});
		});

		if (!docResponse.message) return;
		const invoiceDoc = docResponse.message;

		// 3. Fetch the rendered print HTML
		const baseUrl = frappe.urllib.get_base_url();
		const params = new URLSearchParams({
			doctype: "Sales Invoice",
			name: invoiceName,
			format: printFormat,
			no_letterhead: String(noLetterhead),
			_: String(Date.now()),
		});

		const printViewUrl = `${baseUrl}/printview?${params.toString()}`;
		const fetchResponse = await fetch(printViewUrl);
		if (!fetchResponse.ok) throw new Error("Failed to fetch printview");

		const printHtml = await fetchResponse.text();

		// 4. Save to localStorage
		localStorage.setItem(`posa_print_template_html_${printFormat}`, printHtml);
		localStorage.setItem(`posa_print_template_doc_${printFormat}`, JSON.stringify(invoiceDoc));
		console.log(`Successfully pre-fetched and cached print template for ${printFormat}`);
	} catch (error) {
		console.error("Failed to pre-fetch print template:", error);
	}
}
