/**
 * lumnia-sim/ui / i18n
 *
 * Every display string the two tabs draw, in English first and French for
 * the DRC readers the platform serves. The engine stays language-free —
 * scenario and driver labels are looked up here by key, so model.js never
 * learns what a "Bear" case is called.
 *
 * Tabs take a `locale` prop ("en" default). An unknown locale falls back
 * to English rather than throwing mid-render.
 */

export const STRINGS = {
  en: {
    scenario: { bear: "Bear", base: "Base", bull: "Bull", custom: "Custom" },
    driver: {
      cpoPriceFactor: "CPO price",
      yieldFactor: "Yield factor",
      extractionFactor: "Extraction rate",
      opexFactor: "OPEX factor",
      capexFactor: "CAPEX factor",
    },

    /* ScenarioTab */
    totalRevenueWindow: "Total revenue, full window",
    netMargin: "NET MARGIN",
    finalYearMargin: "FINAL YEAR MARGIN%",
    customLevers: "Custom scenario levers",
    customLeversSub: "Drag to build your own scenario",
    collinearity:
      "Yield and extraction enter the model as a single product. Moving one " +
      "by 10% is identical to moving the other by 10%. Two sliders, one lever.",
    presets: "Preset assumptions",
    load: (label) => `Load ${label}`,
    reset: "Reset",
    revenueByScenario: "Revenue by scenario",
    revenueByScenarioSub: "Annual revenue projection across all four scenarios",
    marginByScenario: "Margin % by scenario",
    marginByScenarioSub: "Operating margin percentage by scenario, year on year",
    windowTotals: "Window totals by scenario",
    windowTotalsSub: "Cumulative revenue, opex and margin across the window",
    revenue: "Revenue",
    opex: "OPEX",
    margin: "Margin",
    comparison: "Full scenario comparison",
    comparisonSub: "Revenue, opex and margin year by year, every scenario",
    yearCol: "YEAR",
    revCol: "Rev",
    marginPctCol: "Margin%",
    totalRow: "TOTAL",
    noData: "No projection data",
    noDataSub: "Pass a rows prop to render this tab",

    /* MonteCarloTab */
    metric: {
      totalRevenue: "Total revenue",
      totalMargin: "Total margin",
      finalYearMarginPct: "Final year margin %",
    },
    group: {
      price: "CPO market price ($/T)",
      yield: "Yield factor",
      extraction: "Extraction factor",
      opex: "OPEX factor",
    },
    mean: "Mean (μ)",
    sd: "Std dev (σ)",
    simParams: "Simulation parameters",
    simParamsSub: "Distribution parameters for each variable",
    trials: "Trials",
    draws: "Number of draws (N)",
    running: "Running…",
    run: (n) => `Run ${n} trials`,
    seedNote: (seed) => `seed ${seed} · reproducible`,
    p10: "P10 · downside",
    p10Sub: "10% of draws below",
    p50: "P50 · median",
    p50Sub: "Half above, half below",
    p90: "P90 · upside",
    p90Sub: "90% of draws below",
    meanSd: "Mean ± σ",
    outcome: "Outcome distribution",
    outcomeSub: (label, n) => `${label} across ${n} trials`,
    frequency: "Frequency",
    frequencyPct: "Frequency %",
    pressRun: "Press Run to generate trials",
    priceVsOutcome: "CPO price vs outcome",
    priceVsOutcomeSub: "Sampled trials, showing sensitivity to CPO price",
    priceAxis: "CPO price ($/T)",
    priceAt: (v) => `CPO price $${v}/T`,
    runFirst: "Run a simulation first",
    probability: "Probability analysis",
    probabilitySub: "Chance of clearing each threshold, measured against plan",
    target: {
      revBeats: "Total revenue beats plan",
      rev15: "Total revenue > plan +15%",
      rev30: "Total revenue > plan +30%",
      marginBeats: "Total margin beats plan",
      margin25: "Total margin > plan +25%",
      finalHolds: "Final year margin holds",
      final10pp: "Final year margin > plan +10pp",
    },
    footNote: (p, seed, nf = (n) => n.toLocaleString()) =>
      `${nf(p.N)} draws, seed ${seed}. CPO price ` +
      `N($${p.cpoPriceMu}, ${p.cpoPriceSd}), yield N(${p.yieldMu.toFixed(2)}, ` +
      `${p.yieldSd.toFixed(2)}), extraction N(${p.extractMu.toFixed(2)}, ` +
      `${p.extractSd.toFixed(2)}), opex N(${p.opexMu.toFixed(2)}, ` +
      `${p.opexSd.toFixed(2)}). Thresholds are relative to the plan as loaded.`,
    runToSee: "Run a simulation to see probabilities",
  },

  fr: {
    scenario: { bear: "Baisse", base: "Base", bull: "Hausse", custom: "Personnalisé" },
    driver: {
      cpoPriceFactor: "Prix CPO",
      yieldFactor: "Facteur de rendement",
      extractionFactor: "Taux d'extraction",
      opexFactor: "Facteur OPEX",
      capexFactor: "Facteur CAPEX",
    },

    /* ScenarioTab */
    totalRevenueWindow: "Revenu total, fenêtre complète",
    netMargin: "MARGE NETTE",
    finalYearMargin: "MARGE % EXERCICE FINAL",
    customLevers: "Leviers du scénario personnalisé",
    customLeversSub: "Faites glisser pour construire votre scénario",
    collinearity:
      "Le rendement et l'extraction entrent dans le modèle comme un seul " +
      "produit. Déplacer l'un de 10 % est identique à déplacer l'autre de " +
      "10 %. Deux curseurs, un seul levier.",
    presets: "Hypothèses prédéfinies",
    load: (label) => `Charger ${label}`,
    reset: "Réinitialiser",
    revenueByScenario: "Revenus par scénario",
    revenueByScenarioSub: "Projection annuelle des revenus pour les quatre scénarios",
    marginByScenario: "Marge % par scénario",
    marginByScenarioSub: "Marge opérationnelle en pourcentage par scénario, année par année",
    windowTotals: "Totaux de la fenêtre par scénario",
    windowTotalsSub: "Revenus, OPEX et marge cumulés sur la fenêtre",
    revenue: "Revenus",
    opex: "OPEX",
    margin: "Marge",
    comparison: "Comparaison complète des scénarios",
    comparisonSub: "Revenus, OPEX et marge année par année, pour chaque scénario",
    yearCol: "ANNÉE",
    revCol: "Rev",
    marginPctCol: "Marge%",
    totalRow: "TOTAL",
    noData: "Aucune donnée de projection",
    noDataSub: "Passez des lignes en prop pour afficher cet onglet",

    /* MonteCarloTab */
    metric: {
      totalRevenue: "Revenu total",
      totalMargin: "Marge totale",
      finalYearMarginPct: "Marge % exercice final",
    },
    group: {
      price: "Prix marché CPO ($/T)",
      yield: "Facteur de rendement",
      extraction: "Facteur d'extraction",
      opex: "Facteur OPEX",
    },
    mean: "Moyenne (μ)",
    sd: "Écart-type (σ)",
    simParams: "Paramètres de simulation",
    simParamsSub: "Paramètres de distribution pour chaque variable",
    trials: "Tirages",
    draws: "Nombre de tirages (N)",
    running: "Calcul…",
    run: (n) => `Lancer ${n} tirages`,
    seedNote: (seed) => `graine ${seed} · reproductible`,
    p10: "P10 · scénario bas",
    p10Sub: "10 % des tirages en dessous",
    p50: "P50 · médiane",
    p50Sub: "Moitié au-dessus, moitié en dessous",
    p90: "P90 · scénario haut",
    p90Sub: "90 % des tirages en dessous",
    meanSd: "Moyenne ± σ",
    outcome: "Distribution des résultats",
    outcomeSub: (label, n) => `${label} sur ${n} tirages`,
    frequency: "Fréquence",
    frequencyPct: "Fréquence %",
    pressRun: "Lancez la simulation pour générer les tirages",
    priceVsOutcome: "Prix CPO contre résultat",
    priceVsOutcomeSub: "Tirages échantillonnés, sensibilité au prix CPO",
    priceAxis: "Prix CPO ($/T)",
    priceAt: (v) => `Prix CPO ${v} $/T`,
    runFirst: "Lancez d'abord une simulation",
    probability: "Analyse de probabilité",
    probabilitySub: "Probabilité de franchir chaque seuil, mesurée contre le plan",
    target: {
      revBeats: "Revenu total au-dessus du plan",
      rev15: "Revenu total > plan +15 %",
      rev30: "Revenu total > plan +30 %",
      marginBeats: "Marge totale au-dessus du plan",
      margin25: "Marge totale > plan +25 %",
      finalHolds: "Marge d'exercice final tenue",
      final10pp: "Marge d'exercice final > plan +10 pts",
    },
    footNote: (p, seed, nf = (n) => n.toLocaleString()) =>
      `${nf(p.N)} tirages, graine ${seed}. Prix CPO ` +
      `N(${p.cpoPriceMu} $, ${p.cpoPriceSd}), rendement N(${p.yieldMu.toFixed(2)}, ` +
      `${p.yieldSd.toFixed(2)}), extraction N(${p.extractMu.toFixed(2)}, ` +
      `${p.extractSd.toFixed(2)}), opex N(${p.opexMu.toFixed(2)}, ` +
      `${p.opexSd.toFixed(2)}). Les seuils sont relatifs au plan tel que chargé.`,
    runToSee: "Lancez une simulation pour voir les probabilités",
  },
};

/** The tab-facing accessor. Unknown locale → English. */
export const strings = (locale) => STRINGS[locale] ?? STRINGS.en;
