// Parsing and grouping for the Vendors sheet exported from the old Google Sheet (tab-separated).

export interface VendorSheetRow {
	line: number
	name: string
	type: string
	category: string
	enterprise: string
}

export interface VendorGroup {
	name: string
	patterns: string[]
	type: string
	category: string
	enterprise: string
	lines: number[]
}

// Columns: Vendor / Customer, Default Type, Default Management Category, Default Enterprise, Notes
export function parseVendorSheet(text: string): VendorSheetRow[] {
	return text
		.split(/\r?\n/)
		.map((line, i) => ({ cells: line.split('\t').map(c => c.trim()), line: i + 1 }))
		.slice(1)
		.filter(({ cells }) => cells[0])
		.map(({ cells, line }) => ({
			line,
			name: cells[0]!,
			type: cells[1] ?? '',
			category: cells[2] ?? '',
			enterprise: cells[3] ?? '',
		}))
}

// Letters and digits only, so 'TRACTOR-SUPPLY' and 'Tractor Supply' compare equal.
const spellingKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const MIN_PREFIX = 5

// Two names are spellings of one vendor when one key starts with the other,
// e.g. 'McDowell Walker Inc' and 'MCDOWELL & WALK'.
function similar(a: string, b: string) {
	const [short, long] = [spellingKey(a), spellingKey(b)].sort((x, y) => x.length - y.length) as [string, string]
	return short.length >= MIN_PREFIX && long.startsWith(short)
}

const sameDefaults = (a: VendorSheetRow, b: VendorGroup) =>
	[
		[a.type, b.type],
		[a.category, b.category],
		[a.enterprise, b.enterprise],
	].every(([x, y]) => x!.toLowerCase() === y!.toLowerCase())

// Prefer a name typed by a person ('Tractor Supply') over a bank's all-caps string, then the longer one.
function displayName(names: string[]) {
	const score = (n: string) => [n === n.toUpperCase() ? 0 : 1, n.length] as const
	return [...names].sort((a, b) => {
		const [sa, sb] = [score(a), score(b)]
		return sb[0] - sa[0] || sb[1] - sa[1]
	})[0]!
}

// Rows with similar names and identical defaults merge into one vendor with several match patterns.
export function groupVendorRows(rows: VendorSheetRow[]): VendorGroup[] {
	const groups: VendorGroup[] = []
	for (const row of rows) {
		const group = groups.find(g => sameDefaults(row, g) && g.patterns.some(p => similar(p, row.name)))
		if (group) {
			if (!group.patterns.some(p => p.toLowerCase() === row.name.toLowerCase())) group.patterns.push(row.name)
			group.lines.push(row.line)
			group.name = displayName(group.patterns)
		} else {
			groups.push({ ...row, patterns: [row.name], lines: [row.line] })
		}
	}
	return groups
}
