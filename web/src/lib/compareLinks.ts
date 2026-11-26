export const COMPARISONS = [
  { a: 'indie', b: 'indie-pop', title: 'How much does indie overlap with indie pop?' },
  { a: 'house', b: 'techno', title: 'How do house and techno differ?' },
  { a: 'songwriter', b: 'singer-songwriter', title: 'Are these two labels interchangeable here?' },
] as const

export function compareUrl(a: string, b: string) {
  return '/compare?' + new URLSearchParams({ a, b }).toString()
}
