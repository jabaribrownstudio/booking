package com.jabaribrownstudio.admin

import org.json.JSONArray
import org.json.JSONObject

data class LineItem(val name: String, val desc: String, val qty: Double, val price: Double) {
    val amount: Double get() = Math.round(qty * price * 100) / 100.0
}

data class Payment(val date: String, val amount: Double, val method: String)

data class Invoice(
    val row: Int, val number: Int, val type: String, val status: String, val date: String, val due: String,
    val client: String, val email: String, val phone: String, val bookingRow: Int,
    val items: List<LineItem>, val total: Double, val paid: Double, val payments: List<Payment>,
    val notes: String, val sent: String, val from: Int,
    val discount: Discount? = null, val taxes: List<TaxRate> = emptyList()
) {
    val isInvoice get() = type == "Invoice"
    val owing: Double get() = if (isInvoice) maxOf(0.0, total - paid) else 0.0
}

data class Discount(val type: String, val value: Double) // type is "percent" or "amount"
data class TaxRate(val name: String, val rate: Double)
data class SavedTax(val row: Int, val name: String, val rate: Double)

class Totals(val subtotal: Double, val discount: Double, val taxes: List<Pair<TaxRate, Double>>, val total: Double)

/** Same sums as the backend: the discount comes off first, then each tax is worked out on what is left. */
fun totals(items: List<LineItem>, discount: Discount?, taxes: List<TaxRate>): Totals {
    val sub = items.sumOf { it.amount }
    var disc = 0.0
    if (discount != null && discount.value > 0) disc = if (discount.type == "amount") discount.value else sub * discount.value / 100
    disc = Math.round(Math.min(Math.max(disc, 0.0), Math.max(sub, 0.0)) * 100) / 100.0
    val base = sub - disc
    val tl = taxes.map { it to Math.round(base * it.rate) / 100.0 }
    return Totals(sub, disc, tl, Math.round((base + tl.sumOf { it.second }) * 100) / 100.0)
}

fun discountJson(d: Discount?): org.json.JSONObject? = d?.let { org.json.JSONObject().put("type", it.type).put("value", it.value) }
fun taxesJson(t: List<TaxRate>): JSONArray { val a = JSONArray(); t.forEach { a.put(JSONObject().put("name", it.name).put("rate", it.rate)) }; return a }

data class Fee(val row: Int, val name: String, val desc: String, val price: Double)

data class Finance(
    val year: Int, val collected: Double, val invoiced: Double, val outstanding: Double, val overdue: Double,
    val estimatesOpen: Int, val estimatesValue: Double, val months: List<Double>, val years: List<Int>
)

data class MoneyData(val invoices: List<Invoice>, val fees: List<Fee>, val finance: Finance, val taxes: List<SavedTax> = emptyList())

fun itemsJson(items: List<LineItem>): JSONArray {
    val a = JSONArray()
    items.forEach { a.put(JSONObject().put("name", it.name).put("desc", it.desc).put("qty", it.qty).put("price", it.price)) }
    return a
}

fun parseMoney(j: JSONObject): MoneyData {
    val inv = ArrayList<Invoice>()
    val ia = j.optJSONArray("invoices") ?: JSONArray()
    for (i in 0 until ia.length()) {
        val o = ia.getJSONObject(i)
        val items = ArrayList<LineItem>()
        val it = o.optJSONArray("items") ?: JSONArray()
        for (k in 0 until it.length()) {
            val x = it.getJSONObject(k)
            items.add(LineItem(x.optString("name"), x.optString("desc"), x.optDouble("qty", 1.0), x.optDouble("price", 0.0)))
        }
        val pays = ArrayList<Payment>()
        val pa = o.optJSONArray("payments") ?: JSONArray()
        for (k in 0 until pa.length()) {
            val x = pa.getJSONObject(k)
            pays.add(Payment(x.optString("date"), x.optDouble("amount", 0.0), x.optString("method")))
        }
        val dj = o.optJSONObject("discount")
        val disc = if (dj != null && dj.optDouble("value", 0.0) > 0) Discount(dj.optString("type"), dj.optDouble("value")) else null
        val tx = ArrayList<TaxRate>()
        val ta = o.optJSONArray("taxes") ?: JSONArray()
        for (k in 0 until ta.length()) { val x = ta.getJSONObject(k); tx.add(TaxRate(x.optString("name"), x.optDouble("rate", 0.0))) }
        inv.add(
            Invoice(
                o.optInt("row"), o.optInt("number"), o.optString("type"), o.optString("status"), o.optString("date"), o.optString("due"),
                o.optString("client"), o.optString("email"), o.optString("phone"), o.optInt("bookingRow"),
                items, o.optDouble("total", 0.0), o.optDouble("paid", 0.0), pays, o.optString("notes"), o.optString("sent"), o.optInt("from"), disc, tx
            )
        )
    }
    val fees = ArrayList<Fee>()
    val fa = j.optJSONArray("fees") ?: JSONArray()
    for (i in 0 until fa.length()) {
        val o = fa.getJSONObject(i)
        fees.add(Fee(o.optInt("row"), o.optString("name"), o.optString("desc"), o.optDouble("price", 0.0)))
    }
    val savedTaxes = ArrayList<SavedTax>()
    val xa = j.optJSONArray("taxes") ?: JSONArray()
    for (i in 0 until xa.length()) { val o = xa.getJSONObject(i); savedTaxes.add(SavedTax(o.optInt("row"), o.optString("name"), o.optDouble("rate", 0.0))) }
    val f = j.optJSONObject("finance") ?: JSONObject()
    val months = ArrayList<Double>()
    val ma = f.optJSONArray("months") ?: JSONArray()
    for (i in 0 until 12) months.add(ma.optDouble(i, 0.0))
    val years = ArrayList<Int>()
    val ya = f.optJSONArray("years") ?: JSONArray()
    for (i in 0 until ya.length()) years.add(ya.optInt(i))
    return MoneyData(
        inv, fees,
        Finance(
            f.optInt("year"), f.optDouble("collected", 0.0), f.optDouble("invoiced", 0.0), f.optDouble("outstanding", 0.0), f.optDouble("overdue", 0.0),
            f.optInt("estimatesOpen"), f.optDouble("estimatesValue", 0.0), months, years
        ),
        savedTaxes
    )
}

/** The package price on a booking ("J$22,000" becomes 22000.0). */
fun bookingPrice(b: Booking): Double = b.price.replace(Regex("[^0-9.]"), "").toDoubleOrNull() ?: 0.0
