/**
 * The year — the view the product is named after.
 *
 * Read-only, and deliberately shows no streak. The longest-run number is the
 * single most abandonment-inducing statistic in the research ("back to zero,
 * through no fault of my own… I just stopped using it entirely"), and the whole
 * point of a year grid is the opposite claim: **a filled day is permanent, and
 * a bad fortnight is a gap in a long run rather than a reset.**
 */

import { loadConfig } from '../lib/config'
import { loadDays } from '../lib/store'
import { localDayKey, yearGrid, type YearCell } from '../lib/time'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CELL = 13
const GAP = 3

function classesFor(cell: YearCell, targetMs: number): string {
  if (cell.day === null) return 'pad'
  const out: string[] = []
  if (cell.isFuture) out.push('future')
  else if (cell.ms >= targetMs) out.push('on')
  else if (cell.ms > 0) out.push('part')
  if (cell.isToday) out.push('today')
  return out.join(' ')
}

function title(cell: YearCell): string {
  if (cell.day === null) return ''
  const mins = Math.floor(cell.ms / 60_000)
  const secs = Math.round(cell.ms / 1000)
  const amount = mins > 0 ? `${mins} min` : secs > 0 ? `${secs}s` : 'nothing'
  return `${cell.day} — ${amount}`
}

async function render(): Promise<void> {
  const now = Date.now()
  const [config, days] = await Promise.all([loadConfig(), loadDays()])

  const target = config?.targetMinutes ?? 25
  const grid = yearGrid(days, now, target)
  const targetMs = target * 60_000

  $('year').textContent = String(grid.year)
  $('habit').textContent = config ? config.habit : 'No habit set up yet.'
  $('filled').textContent = String(grid.filled)
  $('hours').textContent = (grid.totalMs / 3_600_000).toFixed(1)
  $('remaining').textContent = String(grid.remaining)

  // Month labels, positioned absolutely over the week column each month begins
  // in. An earlier version stacked them with flex margins and assumed a fixed
  // label width, which drifted further left with every month — by September the
  // label sat two weeks early. Absolute offsets cannot drift.
  const months = $('months')
  months.innerHTML = ''
  let lastMonth = -1
  grid.weeks.forEach((week, index) => {
    const first = week.find((c) => c.day !== null)
    if (!first?.day) return
    const month = Number(first.day.slice(5, 7)) - 1
    if (month === lastMonth) return
    lastMonth = month
    const label = document.createElement('span')
    label.textContent = MONTHS[month] ?? ''
    label.style.left = `${index * (CELL + GAP)}px`
    months.appendChild(label)
  })

  const board = $('grid')
  board.innerHTML = ''
  for (const week of grid.weeks) {
    const col = document.createElement('div')
    col.className = 'week'
    for (const cell of week) {
      const dot = document.createElement('i')
      dot.className = classesFor(cell, targetMs)
      const t = title(cell)
      if (t) dot.title = t
      col.appendChild(dot)
    }
    board.appendChild(col)
  }

  const todayMs = days[localDayKey(now)] ?? 0
  $('note').innerHTML =
    grid.filled === 0
      ? 'Nothing filled in yet. <b>Every day you finish stays here permanently</b> — there is no streak to break and nothing that can take one back.'
      : `<b>${grid.filled} day${grid.filled === 1 ? '' : 's'} done this year.</b> They stay filled whatever happens next — a quiet fortnight is a gap in a long run, not a reset to nothing. ` +
        (todayMs >= targetMs
          ? "Today is already one of them."
          : `Today has ${Math.floor(todayMs / 60_000)} of ${target} minutes on it.`)
}

$('back').addEventListener('click', () => {
  window.close()
})

void render()
