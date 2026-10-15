importScripts("/assets/posawesome/js/libs/dexie.min.js");

const db = new Dexie("posawesome_offline");
db.version(1).stores({ keyval: "&key" });

const normalizeSearchValue = (value) =>
	String(value || "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();

const uniqueStrings = (values) =>
	Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));

const deriveItemSearchFields = (it) => {
	const barcodes = uniqueStrings([
		...(Array.isArray(it.item_barcode)
			? it.item_barcode.map((b) => b && b.barcode)
			: it.item_barcode
				? [String(it.item_barcode)]
				: []),
		...(Array.isArray(it.barcodes)
			? it.barcodes.map((entry) => (entry && typeof entry === "object" ? entry.barcode : entry))
			: []),
	]);
	const nameKeywords = uniqueStrings(it.item_name ? normalizeSearchValue(it.item_name).split(/\s+/) : []);
	const itemCodeLc = normalizeSearchValue(it.item_code);
	const itemNameLc = normalizeSearchValue(it.item_name);
	const barcodesLc = barcodes.map(normalizeSearchValue).filter(Boolean);
	const nameKeywordsLc = nameKeywords.map(normalizeSearchValue).filter(Boolean);

	return {
		barcodes,
		name_keywords: nameKeywords,
		item_code_lc: itemCodeLc,
		item_name_lc: itemNameLc,
		barcodes_lc: barcodesLc,
		name_keywords_lc: nameKeywordsLc,
		search_text: [itemCodeLc, itemNameLc, ...barcodesLc, ...nameKeywordsLc].filter(Boolean).join(" "),
	};
};

const LOCAL_STORAGE_KEYS = new Set([
	"manual_offline",
	"tax_inclusive",
	"cache_version",
	"items_last_sync",
	"customers_last_sync",
]);

async function persist(key, value) {
	try {
		if (!db.isOpen()) {
			await db.open();
		}
		await db.table("keyval").put({ key, value });
	} catch (e) {
		console.error("Worker persist failed", e);
	}

	if (typeof localStorage !== "undefined" && LOCAL_STORAGE_KEYS.has(key)) {
		try {
			localStorage.setItem(`posa_${key}`, JSON.stringify(value));
		} catch (err) {
			console.error("Worker localStorage failed", err);
		}
	}
}

self.onmessage = async (event) => {
	const data = event.data || {};
	if (data.type === "parse_and_cache") {
		try {
			const parsed = JSON.parse(data.json);
			const itemsRaw = parsed.message || parsed;
			let items;
			try {
				if (typeof structuredClone === "function") {
					items = structuredClone(itemsRaw);
				} else {
					// Fallback for older browsers
					items = JSON.parse(JSON.stringify(itemsRaw));
				}
			} catch (e) {
				console.error("Failed to clone items", e);
				self.postMessage({ type: "error", error: e.message });
				return;
			}

			// Enrich items with normalized search index fields for instant matching
			const enrichedItems = items.map((it) => {
				const searchFields = deriveItemSearchFields(it);
				return {
					...it,
					...searchFields,
				};
			});

			let cache = {};
			try {
				if (!db.isOpen()) {
					await db.open();
				}
				const stored = await db.table("keyval").get("price_list_cache");
				if (stored && stored.value) cache = stored.value;
			} catch (e) {
				console.error("Failed to read cache in worker", e);
			}

			cache[data.priceList] = { items: enrichedItems, timestamp: Date.now() };
			await persist("price_list_cache", cache);

			// Track latest modified timestamp for delta sync
			let maxModified = "";
			for (const it of enrichedItems) {
				if (it.modified && it.modified > maxModified) {
					maxModified = it.modified;
				}
			}

			self.postMessage({
				type: "parsed",
				items: enrichedItems,
				maxModified: maxModified || null,
			});

			items = null;
		} catch (err) {
			console.error("Worker parse_and_cache error", err);
			self.postMessage({ type: "error", error: err.message });
		}
	} else if (data.type === "persist") {
		await persist(data.key, data.value);
		self.postMessage({ type: "persisted", key: data.key });
	}
};
