const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export const formatMoney = (amount: string | number) => money.format(Number(amount))

// Local calendar date as YYYY-MM-DD (toISOString would give tomorrow's date on US evenings).
export function localToday() {
	const d = new Date()
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
