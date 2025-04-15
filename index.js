import express from "express";
import fetch from "node-fetch";
import { Buffer } from "buffer";
import { XMLParser } from "fast-xml-parser";

const app = express();

app.get("/feed.csv", async (req, res) => {
  const url = "https://apiv1.erotikamarket.hu/service_v2/productsXmlGenerator_sk.php";
  const username = "incike@azet.sk";
  const password = "2007Mark";
  const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  console.log(`[${new Date().toISOString()}] Lekérés: /feed.csv`);

  try {
    const response = await fetch(url, {
      headers: { Authorization: auth }
    });

    if (!response.ok) {
      return res.status(500).send("Hiba történt a feed lekérésekor.");
    }

    const xmlText = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseTagValue: true
    });

    const json = parser.parse(xmlText);
    const rawProducts = json.document.products.product;
    const products = Array.isArray(rawProducts) ? rawProducts : [rawProducts];

    if (!products.length) {
      return res.status(500).send("Nem található <product> adat.");
    }

    // 🧠 Map: common => főtermék (main) teljes objektuma
    const mainMap = new Map();
    for (const p of products) {
      if (p.type === "main" && p.partnumber) {
        mainMap.set(p.partnumber, p);
      }
    }

    // 🔁 Objektum lapítása
    const flattenObject = (obj, parentKey = "") => {
      const result = {};
      for (const key in obj) {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        const value = obj[key];

        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            if (typeof item === "object") {
              Object.assign(result, flattenObject(item, `${fullKey}[${index}]`));
            } else {
              result[`${fullKey}[${index}]`] = item;
            }
          });
        } else if (typeof value === "object" && value !== null) {
          Object.assign(result, flattenObject(value, fullKey));
        } else {
          result[fullKey] = value;
        }
      }
      return result;
    };

    // ❌ Kizárandó mezők (SK leírás marad!)
    const excludedKeys = new Set([
      "name.us", "name.de", "name.cz",
      "shipping_date", "unit_qt", "unit",
      "prices.ar3", "prices.ar4", "prices.ar6", "prices.ar7", "prices.ar8",
      "descriptions.us", "descriptions.de", "descriptions.cz",
      "product_category.category[0]", "product_category.category[1]",
      "product_category.category[2]", "product_category.category[3]",
      "product_category.category[4]", "product_category.category[5]",
      "product_category.category[6]",
      "stock",
      ...Array.from({ length: 21 }, (_, i) => `property_list.jell_${i + 1}`).filter(k => !k.endsWith("_14"))
    ]);

    const excludedPatterns = [".modif"];

    const flatProducts = [];
    const allKeys = new Set();

    for (const p of products) {
      const isSub = p.type === "sub";
      const common = p.common || p.partnumber || "";
      const subtype = p.subtype || "";

      // 👉 másolat, szükség esetén kiegészítjük szülőből
      const merged = { ...p };

      const main = mainMap.get(common);
      if (main) {
        const mainName = typeof main.name === "object" ? main.name.sk || "" : main.name || "";
        merged.name = `${mainName} - ${subtype || p.subtype || ""}`.trim();

        if (
          (!p.descriptions || !p.descriptions.sk) &&
          main.descriptions && main.descriptions.sk
        ) {
          merged.descriptions = merged.descriptions || {};
          merged.descriptions.sk = main.descriptions.sk;
        }

        if (!p.images && main.images) {
          merged.images = main.images;
        }

        if (!p.image_list && main.image_list) {
          merged.image_list = main.image_list;
        }
      } else {
        const fallbackName = typeof p.name === "object" ? p.name.sk || "" : p.name || "";
        merged.name = fallbackName + (subtype ? ` - ${subtype}` : "");
      }

      const flat = flattenObject(merged);

      // 👉 product_category legyen mindig: NOVINKY
      flat["product_category"] = "NOVINKY";

      for (const key in flat) {
        const isExcluded =
          excludedKeys.has(key) ||
          excludedPatterns.some(pattern => key.endsWith(pattern));
        if (!isExcluded) {
          allKeys.add(key);
        }
      }

      flatProducts.push(flat);
    }

    const headers = Array.from(allKeys);
    let csv = headers.join(";") + "\n";

    for (const flat of flatProducts) {
      const row = headers.map(h => {
        const val = flat[h] ?? "";
        return `"${val.toString().replace(/"/g, '""').replace(/[\n\r;]/g, " ")}"`;
      });
      csv += row.join(";") + "\n";
    }

    res.set("Content-Type", "text/csv; charset=UTF-8");
    res.send(csv);
  } catch (err) {
    console.error("Hiba:", err);
    res.status(500).send("Hiba a feldolgozás során.");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Szerver fut: http://localhost:${port}/feed.csv`);
});
