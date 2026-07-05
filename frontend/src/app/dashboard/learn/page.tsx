'use client'

import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import type { ApiResponse, WasteType, WasteCategory } from '@/types'

// ─── RF-06.3: Soporte bilingüe español / quechua cusqueño (qosqo runasimi) ────

type Lang = 'es' | 'qu'

const LANG_STORAGE_KEY = 'learn-language'

// Textos de interfaz por idioma
const UI_TEXT: Record<Lang, {
  title: string
  subtitle: string
  searchPlaceholder: string
  all: string
  wasteTypesCount: (n: number) => string
  examples: string
  handling: string
  noResultsTitle: string
  noResultsSearch: (q: string) => string
  noResultsEmpty: string
  clearSearch: string
  languageLabel: string
  categoryGuideLabel: string
}> = {
  es: {
    title: 'Aprende a segregar',
    subtitle: 'Guía visual de clasificación de residuos sólidos — NTP 900.058',
    searchPlaceholder: 'Buscar residuo (ej: botella, cáscara, pila…)',
    all: 'Todos',
    wasteTypesCount: (n) => `(${n} tipos de residuos)`,
    examples: 'Ejemplos',
    handling: 'Manejo correcto:',
    noResultsTitle: 'Sin Resultados',
    noResultsSearch: (q) => `No hay resultados educativos para "${q}"`,
    noResultsEmpty: 'No hay información de residuos cargada en la guía.',
    clearSearch: 'Limpiar búsqueda',
    languageLabel: 'Idioma',
    categoryGuideLabel: 'Guía general',
  },
  qu: {
    title: "Q'upakuna t'aqayta yachay",
    subtitle: "Q'upakuna t'aqanapaq qhaway pusaq — NTP 900.058",
    searchPlaceholder: "Q'upata maskay (ej: botella, cáscara, pila…)",
    all: 'Llapan',
    wasteTypesCount: (n) => `(${n} q'upa rikch'aq)`,
    examples: 'Qhawarichiykuna',
    handling: 'Allin ruway:',
    noResultsTitle: 'Mana tarisqa',
    noResultsSearch: (q) => `Manan "${q}" nisqapaq imapas tarikunchu`,
    noResultsEmpty: "Manan q'upakunamanta willakuy kay pusaqpi kanchu.",
    clearSearch: 'Maskayta pichay',
    languageLabel: 'Simi / Idioma',
    categoryGuideLabel: 'Hatun pusaq / Guía general',
  },
}

// Nombres, descripciones y guías generales de las 4 categorías por idioma.
// Las traducciones al quechua cusqueño usan préstamos del español cuando no
// existe un término exacto (p. ej. "plástico", "pila"), con su explicación.
const CATEGORY_I18N: Record<WasteCategory, {
  es: { label: string; guide: string }
  qu: { label: string; guide: string }
}> = {
  ORGANIC: {
    es: {
      label: 'Orgánicos',
      guide: 'Restos de comida, cáscaras y residuos de jardín que se descomponen. Deposítalos en el contenedor marrón: pueden convertirse en abono (compost).',
    },
    qu: {
      label: "Wanu q'upa (ismuq)",
      guide: "Mikhuna puchukuna, qarakuna, sach'a raphikuna ima: kaykunaqa ismunku. Ch'umpi tachaman churay: wanuman (compost nisqaman) tukunkuman.",
    },
  },
  RECYCLABLE: {
    es: {
      label: 'Reciclables',
      guide: 'Papel, cartón, vidrio, plástico y metales limpios y secos. Sepáralos correctamente para que puedan reaprovecharse (reciclaje).',
    },
    qu: {
      label: "Kutichikuq q'upa",
      guide: "Papel, cartón, qhispi (vidrio), plástico, metal ima: ch'uya, ch'aki kanan. Allinta t'aqay, musuqmanta llamk'achinapaq (reciclaje nisqa).",
    },
  },
  NON_RECYCLABLE: {
    es: {
      label: 'No reciclables',
      guide: 'Residuos que ya no pueden reaprovecharse, como papel higiénico o envolturas sucias. Deposítalos en el contenedor negro.',
    },
    qu: {
      label: "Mana kutichikuq q'upa",
      guide: "Mana kutichiy atina q'upakuna, papel higiénico, qhilli envoltura hina. Yana tachaman churay.",
    },
  },
  HAZARDOUS: {
    es: {
      label: 'Peligrosos',
      guide: 'Pilas, baterías, medicamentos vencidos y químicos que dañan la salud y el ambiente. Manéjalos con cuidado y entrégalos en puntos autorizados.',
    },
    qu: {
      label: "Chiki q'upa (peligroso)",
      guide: "Pilakuna, bateriyakuna, mawk'a hampikuna (medicamentos), químico nisqakuna ima: kawsayta, pachamamata onqochinkuman. Allin allinta hap'iy, kamachisqa churana kitikunaman apay.",
    },
  },
}

// NTP 900.058 color mapping - Estética editorial (los códigos de color se mantienen)
const CATEGORY_CONFIG: Record<WasteCategory, { bg: string; border: string; badge: string; dot: string; text: string }> = {
  ORGANIC:        { bg: 'bg-amber-50/40',    border: 'border-amber-200',  badge: 'bg-amber-800 text-white',    dot: '#92400e', text: 'text-amber-900' },
  RECYCLABLE:     { bg: 'bg-blue-50/40',     border: 'border-blue-200',   badge: 'bg-blue-800 text-white',     dot: '#1e40af', text: 'text-blue-900' },
  NON_RECYCLABLE: { bg: 'bg-slate-50',       border: 'border-slate-200',  badge: 'bg-slate-700 text-white',    dot: '#334155', text: 'text-slate-800' },
  HAZARDOUS:      { bg: 'bg-orange-50/40',   border: 'border-orange-200', badge: 'bg-orange-850 text-white',   dot: '#c2410c', text: 'text-orange-900' },
}

const ALL_CATEGORIES: WasteCategory[] = ['ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE', 'HAZARDOUS']

export default function LearnPage() {
  const { accessToken } = useAuth()
  const [wasteTypes, setWasteTypes] = useState<WasteType[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<WasteCategory | 'ALL'>('ALL')
  const [lang, setLang] = useState<Lang>('es')

  // RF-06.3: recuperar el idioma elegido (persistido en localStorage)
  useEffect(() => {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY)
    if (saved === 'es' || saved === 'qu') setLang(saved)
  }, [])

  function changeLang(next: Lang) {
    setLang(next)
    window.localStorage.setItem(LANG_STORAGE_KEY, next)
  }

  useEffect(() => {
    if (!accessToken) return
    api
      .get<ApiResponse<WasteType[]>>('/waste-types', accessToken)
      .then((r) => setWasteTypes((r.data ?? []).filter((w) => w.isActive)))
      .catch(() => {})
      .finally(() => setLoading(false))

    // RF-16: Registrar visita educativa para el reporte de participación
    api.post('/page-visits/learn', {}, accessToken).catch(() => {})
  }, [accessToken])

  const t = UI_TEXT[lang]

  const filtered = useMemo(() => {
    return wasteTypes.filter((w) => {
      const matchCategory = activeCategory === 'ALL' || w.category === activeCategory
      const q = search.toLowerCase()
      // El buscador funciona en ambos idiomas: coincide con los datos en
      // español de la BD y con los nombres de categoría en español y quechua.
      const catI18n = CATEGORY_I18N[w.category]
      const matchSearch =
        !q ||
        w.name.toLowerCase().includes(q) ||
        w.examples.some((e) => e.toLowerCase().includes(q)) ||
        (w.description?.toLowerCase().includes(q) ?? false) ||
        catI18n.es.label.toLowerCase().includes(q) ||
        catI18n.qu.label.toLowerCase().includes(q)
      return matchCategory && matchSearch
    })
  }, [wasteTypes, search, activeCategory])

  const countByCategory = useMemo(
    () => Object.fromEntries(ALL_CATEGORIES.map((c) => [c, wasteTypes.filter((w) => w.category === c).length])),
    [wasteTypes],
  )

  return (
    <div className="p-8 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="mb-8 border-b border-slate-100 pb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-slate-900 tracking-tight">{t.title}</h1>
          <p className="text-slate-500 text-xs tracking-wider uppercase mt-1.5 font-bold">
            {t.subtitle}
          </p>
        </div>

        {/* RF-06.3: Selector de idioma español / quechua */}
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{t.languageLabel}</span>
          <div className="flex bg-slate-100 rounded p-0.5" role="group" aria-label={t.languageLabel}>
            <button
              onClick={() => changeLang('es')}
              aria-pressed={lang === 'es'}
              className={`px-3 py-1.5 rounded text-xs font-bold tracking-wider uppercase transition-colors ${
                lang === 'es' ? 'bg-teal-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Español
            </button>
            <button
              onClick={() => changeLang('qu')}
              aria-pressed={lang === 'qu'}
              className={`px-3 py-1.5 rounded text-xs font-bold tracking-wider uppercase transition-colors ${
                lang === 'qu' ? 'bg-teal-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Runasimi
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="w-full sm:max-w-xs px-3 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:border-slate-800 transition-colors bg-white"
        />
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1.5 mb-8">
        <button
          onClick={() => setActiveCategory('ALL')}
          className={`px-3 py-1.5 rounded text-xs font-bold tracking-wider uppercase transition-colors ${
            activeCategory === 'ALL'
              ? 'bg-teal-800 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {t.all} ({wasteTypes.length})
        </button>
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded text-xs font-bold tracking-wider uppercase transition-colors ${
              activeCategory === cat
                ? 'bg-teal-800 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {CATEGORY_I18N[cat][lang].label} ({countByCategory[cat] ?? 0})
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-teal-700 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t.noResultsTitle}</p>
          <p className="text-slate-500 text-sm">
            {search ? t.noResultsSearch(search) : t.noResultsEmpty}
          </p>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="mt-4 text-xs font-bold uppercase tracking-wider text-teal-800 hover:text-teal-950"
            >
              {t.clearSearch}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {(activeCategory === 'ALL' ? ALL_CATEGORIES : [activeCategory]).map((cat) => {
            const items = filtered.filter((w) => w.category === cat)
            if (items.length === 0) return null
            const cfg = CATEGORY_CONFIG[cat]
            const i18n = CATEGORY_I18N[cat][lang]
            const altLabel = CATEGORY_I18N[cat][lang === 'es' ? 'qu' : 'es'].label
            return (
              <section key={cat}>
                <div className="flex flex-wrap items-center gap-3 mb-2 border-b border-slate-100 pb-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
                  <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{i18n.label}</h2>
                  {/* Formato bilingüe: se muestra la equivalencia en el otro idioma */}
                  <span className="text-[10px] text-slate-400 font-medium italic">— {altLabel}</span>
                  <span className="text-[10px] text-slate-400 font-medium">{t.wasteTypesCount(items.length)}</span>
                </div>
                {/* RF-06.3: guía general de la categoría en el idioma elegido */}
                <p className="text-xs text-slate-500 leading-relaxed mb-5 max-w-3xl">
                  <span className="font-bold uppercase text-[9px] tracking-widest text-slate-400 mr-1.5">{t.categoryGuideLabel}:</span>
                  {i18n.guide}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {items.map((w) => (
                    <WasteCard key={w.id} waste={w} cfg={cfg} lang={lang} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WasteCard({
  waste,
  cfg,
  lang,
}: {
  waste: WasteType
  cfg: { bg: string; border: string; badge: string; dot: string; text: string }
  lang: Lang
}) {
  const t = UI_TEXT[lang]
  return (
    <div className={`rounded-xl border p-5 flex flex-col justify-between min-h-[160px] ${cfg.bg} ${cfg.border}`}>
      <div>
        {/* Header — el nombre del residuo proviene de la BD (en español) */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: waste.colorCode }}
            />
            <h3 className={`font-bold text-sm uppercase tracking-wide truncate ${cfg.text}`}>{waste.name}</h3>
          </div>
        </div>

        {/* Description */}
        {waste.description && (
          <p className={`text-xs mb-4 leading-relaxed ${cfg.text} opacity-85`}>{waste.description}</p>
        )}

        {/* Examples */}
        {waste.examples.length > 0 && (
          <div className="mb-4">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">{t.examples}</span>
            <div className="flex flex-wrap gap-1.5">
              {waste.examples.map((ex, i) => (
                <span key={i} className="text-[10px] font-medium px-2.5 py-0.5 bg-white/70 rounded border border-white/40 text-slate-650">
                  {ex}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      {waste.instructions && (
        <div className="border-t border-white/50 pt-3 mt-3 text-[11px] leading-relaxed">
          <span className="font-bold uppercase text-[9px] tracking-wide block mb-0.5">{t.handling}</span>
          <p className={`${cfg.text} opacity-75`}>{waste.instructions}</p>
        </div>
      )}
    </div>
  )
}
