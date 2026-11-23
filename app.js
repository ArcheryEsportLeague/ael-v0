/**
 * ============================================================================
 * ARCHERY E-SPORT LEAGUE (AEL) — INTERFACE MOBILE TERRAIN (WEB APP V0.1)
 * ============================================================================
 * Fichier : app.js (Brique 2 — Parcours 1 Téléphone Passe & Joue, 100 % hors-ligne)
 * Dépend  : moteur.js (window.AELMoteur)
 * Zéro compte, zéro serveur, zéro donnée personnelle : tout reste en localStorage.
 * ============================================================================
 */

(function () {
  'use strict';

  const M = window.AELMoteur;
  if (!M) {
    document.getElementById('app').innerHTML =
      '<div class="card card-danger"><strong>Erreur :</strong> le fichier <code>moteur.js</code> est introuvable.</div>';
    return;
  }

  const STORAGE_KEY = 'ael_v01_session';
  const PREFS_KEY = 'ael_v01_prefs';

  const ARMES = [
    { id: 'poulies', label: 'Poulies', seuil: 34 },
    { id: 'classique', label: 'Classique', seuil: 29 },
    { id: 'arc_nu', label: 'Arc Nu', seuil: 26 }
  ];

  const WA_KEYS = [
    { code: 'X', sub: '12 pts', cls: 'wa-yellow' },
    { code: '10', sub: '', cls: 'wa-yellow' },
    { code: '9', sub: '', cls: 'wa-yellow' },
    { code: '8', sub: '', cls: 'wa-red' },
    { code: '7', sub: '', cls: 'wa-red' },
    { code: '6', sub: '', cls: 'wa-blue' },
    { code: '5', sub: '', cls: 'wa-blue' },
    { code: '4', sub: '', cls: 'wa-black' },
    { code: '3', sub: '', cls: 'wa-black' },
    { code: '2', sub: '', cls: 'wa-white' },
    { code: '1', sub: '', cls: 'wa-white' },
    { code: 'M', sub: '0 pt', cls: 'wa-miss' }
  ];

  // --------------------------------------------------------------------------
  // 1. ÉTAT GLOBAL & SAUVEGARDE AUTOMATIQUE (localStorage)
  // --------------------------------------------------------------------------

  let prefs = chargerPrefs();
  let state = creerEtatParDefaut();

  function creerEtatParDefaut() {
    return {
      screen: 'home', // home | setup | warmup | prog0 | curtain | prog1 | timer | scoring | verify | reveal | fleche_ko | gameover
      setup: {
        modeJeu: 'decouverte', // Par défaut : Mode Découverte (avec raccourci Complet)
        typeDuel: 'pur',       // pur | equilibre
        echauffementValide: false,
        calibMode: 'guidee',   // guidee | rapide
        calibJoueurActif: 0,
        calibFleches: [[], []],
        calibTotaux: ['', ''],
        joueurs: [
          { nom: '', arme: 'classique' },
          { nom: '', arme: 'classique' }
        ]
      },
      match: null,
      prog: [
        { bouclier: null, jeton: null, allIn: false },
        { bouclier: null, jeton: null, allIn: false }
      ],
      scoring: {
        fleches: [[], []],
        curJoueur: 0,
        curSlot: 0
      },
      rapport: null,
      revealStep: 1,
      flecheKO: {
        fleches: [null, null],
        curJoueur: 0,
        egaliteEnAttente: false,
        message: ''
      }
    };
  }

  function chargerPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { soleil: Boolean(parsed.soleil), muet: Boolean(parsed.muet) };
      }
    } catch (e) {}
    return { soleil: false, muet: false };
  }

  function sauverPrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {}
  }

  function sauverSession() {
    try {
      if (state.match && state.screen !== 'home') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } else if (!state.match) {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {}
  }

  function chargerSessionSauvee() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.match) return parsed;
    } catch (e) {}
    return null;
  }

  function effacerSessionSauvee() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // --------------------------------------------------------------------------
  // 2. PROTECTION ANTI-RETOUR & ANTI-F5 (ÉCRAN-RIDEAU BLINDÉ)
  // --------------------------------------------------------------------------

  function activerProtectionNavigation() {
    try {
      window.history.pushState({ aelGuard: true }, '', window.location.href);
    } catch (e) {}
  }

  window.addEventListener('popstate', function () {
    // Empêche le geste "Retour" Android de révéler les choix du Joueur 1
    if (state.screen !== 'home') {
      activerProtectionNavigation();
      if (state.screen === 'curtain' || state.screen === 'prog1') {
        afficherAlerteRapide('Retour bloqué pour protéger les choix secrets de ' + state.match.joueurs[0].nom + '.');
      }
    }
  });

  window.addEventListener('beforeunload', function (e) {
    if (state.match && state.match.statut !== 'termine' && state.screen !== 'home') {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // --------------------------------------------------------------------------
  // 3. CHRONOMÈTRE & BIPS SONORES (Web Audio API — 100 % hors-ligne)
  // --------------------------------------------------------------------------

  let chrono = {
    intervalId: null,
    phase: 'idle', // idle | prep | shoot | done
    restant: 15,
    enPause: false,
    modeFlecheKO: false
  };

  let audioCtx = null;

  function jouerBip(freq, dureeMs, nbBips) {
    if (prefs.muet) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const count = nbBips || 1;
      for (let i = 0; i < count; i++) {
        const start = audioCtx.currentTime + i * ((dureeMs + 110) / 1000);
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq || 880, start);
        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dureeMs / 1000);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + dureeMs / 1000);
      }
    } catch (e) {}
  }

  function arreterChrono() {
    if (chrono.intervalId) {
      clearInterval(chrono.intervalId);
      chrono.intervalId = null;
    }
  }

  function reinitialiserChrono(modeFlecheKO) {
    arreterChrono();
    chrono.modeFlecheKO = Boolean(modeFlecheKO);
    chrono.phase = 'idle';
    chrono.restant = 15;
    chrono.enPause = false;
  }

  function demarrerChrono(modeFlecheKO) {
    arreterChrono();
    chrono.modeFlecheKO = Boolean(modeFlecheKO);
    chrono.phase = 'prep';
    chrono.restant = 15;
    chrono.enPause = false;
    jouerBip(660, 180, 2); // 2 bips : En place !
    mettreAJourAffichageChrono();

    chrono.intervalId = setInterval(function () {
      if (chrono.enPause) return;
      chrono.restant -= 1;

      if (chrono.phase === 'prep' && chrono.restant <= 0) {
        chrono.phase = 'shoot';
        chrono.restant = chrono.modeFlecheKO ? 30 : 90;
        jouerBip(980, 320, 1); // 1 bip aigu : Tirez !
      } else if (chrono.phase === 'shoot' && chrono.restant === 30 && !chrono.modeFlecheKO) {
        jouerBip(740, 140, 1); // Repère 30 s
      } else if (chrono.phase === 'shoot' && chrono.restant <= 0) {
        chrono.phase = 'done';
        chrono.restant = 0;
        arreterChrono();
        jouerBip(520, 220, 3); // 3 bips : Fin de volée !
      }
      mettreAJourAffichageChrono();
    }, 1000);
  }

  function basculerPauseChrono() {
    if (chrono.phase === 'idle' || chrono.phase === 'done') return;
    chrono.enPause = !chrono.enPause;
    mettreAJourAffichageChrono();
  }

  function mettreAJourAffichageChrono() {
    const panel = document.getElementById('chronoPanel');
    const digits = document.getElementById('chronoDigits');
    const status = document.getElementById('chronoStatus');
    const btnPause = document.getElementById('btnChronoPause');
    const btnStart = document.getElementById('btnChronoStart');
    if (!panel || !digits || !status) return;

    panel.className = 'chrono-panel';
    const dureeTir = chrono.modeFlecheKO ? 30 : 90;

    if (chrono.phase === 'idle') {
      status.textContent = 'Prêt derrière la ligne (15 s + ' + dureeTir + ' s)';
      digits.textContent = '0:' + String(15).padStart(2, '0');
    } else if (chrono.phase === 'prep') {
      panel.classList.add('phase-prep');
      status.textContent = chrono.enPause ? '⏸ EN PAUSE (Pré-décompte)' : 'EN PLACE ! Montez sur la ligne';
      digits.textContent = String(chrono.restant) + ' s';
    } else if (chrono.phase === 'shoot') {
      if (chrono.restant <= 30 && !chrono.modeFlecheKO) {
        panel.classList.add('phase-warn');
      } else if (chrono.restant <= 10 && chrono.modeFlecheKO) {
        panel.classList.add('phase-warn');
      } else {
        panel.classList.add('phase-shoot');
      }
      status.textContent = chrono.enPause ? '⏸ EN PAUSE' : 'TIREZ ! (Simultané)';
      const min = Math.floor(chrono.restant / 60);
      const sec = chrono.restant % 60;
      digits.textContent = min > 0 ? (min + ':' + String(sec).padStart(2, '0')) : (chrono.restant + ' s');
    } else {
      panel.classList.add('phase-done');
      status.textContent = 'TEMPS ÉCOULÉ — STOP !';
      digits.textContent = '0 s';
    }

    if (btnPause) {
      btnPause.disabled = (chrono.phase === 'idle' || chrono.phase === 'done');
      btnPause.textContent = chrono.enPause ? '▶ Reprendre' : '⏸ Pause';
    }
    if (btnStart) {
      btnStart.textContent = chrono.phase === 'idle'
        ? ('▶ Lancer le chrono (15 s + ' + dureeTir + ' s)')
        : '🔄 Relancer le chrono';
    }
  }

  // --------------------------------------------------------------------------
  // 4. UTILITAIRES VISUELS & MODALES
  // --------------------------------------------------------------------------

  function esc(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function labelArme(id) {
    const a = ARMES.find(function (x) { return x.id === id; });
    return a ? a.label : id;
  }

  function classeCouleurFleche(code) {
    const c = String(code).toUpperCase();
    if (c === 'X' || c === '10' || c === '9') return 'wa-yellow';
    if (c === '8' || c === '7') return 'wa-red';
    if (c === '6' || c === '5') return 'wa-blue';
    if (c === '4' || c === '3') return 'wa-black';
    if (c === '2' || c === '1') return 'wa-white';
    return 'wa-miss';
  }

  function libelleRole(role) {
    if (role === 'bouclier') return '🛡️ Bouclier';
    if (role === 'surcharge') return '⚡ Surcharge ×2';
    if (role === 'brise_garde') return '💥 Brise-Garde';
    return '⚔️ Attaque';
  }

  function appliquerTheme() {
    document.body.classList.toggle('soleil', prefs.soleil);
    const btn = document.getElementById('btnTheme');
    if (btn) btn.textContent = prefs.soleil ? '🌙 Sombre' : '☀️ Soleil';
  }

  function fermerModale() {
    const root = document.getElementById('modalRoot');
    root.className = 'hidden';
    root.innerHTML = '';
  }

  function ouvrirModale(htmlContenu) {
    const root = document.getElementById('modalRoot');
    root.className = 'modal-backdrop';
    root.innerHTML = '<div class="modal-sheet">' + htmlContenu + '</div>';
    root.onclick = function (e) {
      if (e.target === root) fermerModale();
    };
  }

  function afficherAlerteRapide(msg) {
    ouvrirModale(
      '<h3>🔒 Sécurité Passe & Joue</h3>' +
      '<p class="muted">' + esc(msg) + '</p>' +
      '<button class="btn btn-accent mt-12" id="btnCloseModal" type="button">OK</button>'
    );
    document.getElementById('btnCloseModal').onclick = fermerModale;
  }

  function ouvrirModaleDetails() {
    const match = state.match;
    if (!match) return;
    const j0 = match.joueurs[0];
    const j1 = match.joueurs[1];

    let histHtml = '';
    if (match.historique.length === 0) {
      histHtml = '<p class="muted small">Aucune volée encore résolue.</p>';
    } else {
      histHtml = match.historique.slice().reverse().map(function (h) {
        return '<div class="detail-row"><span>M' + h.manche + 'V' + h.volee + '</span>' +
          '<span>' + esc(j0.nom) + ' : ' + h.pvApres[0] + ' PV • ' + esc(j1.nom) + ' : ' + h.pvApres[1] + ' PV</span></div>';
      }).join('');
    }

    const autreMode = match.modeJeu === 'decouverte' ? 'complet' : 'decouverte';
    const txtSwitch = match.modeJeu === 'decouverte'
      ? '⚡ Passer ce match en Mode Complet v12.0'
      : '🌱 Revenir en Mode Découverte';

    const buildJoueurBloc = function (j) {
      return '<div class="card" style="padding:11px;margin-bottom:8px;">' +
        '<strong>' + esc(j.nom) + '</strong> <span class="muted small">(' + labelArme(j.arme) + ')</span>' +
        '<div class="detail-row"><span>PV restants</span><strong>' + j.pv + ' / 99</strong></div>' +
        '<div class="detail-row"><span>Armure Active totale</span><strong>🛡️ ' + M.getArmureActive(j) + '</strong></div>' +
        '<div class="detail-row small"><span class="muted">↳ Équilibrage / Souffle / Rempart</span><span>' +
          j.armureEquilibrage + ' / ' + j.armureSouffle + ' / ' + j.armureRempart + '</span></div>' +
        '<div class="detail-row"><span>Bilan de Manche en cours</span><strong>' + M.getBilanManche(j) + '</strong></div>' +
        (match.modeJeu === 'complet'
          ? '<div class="detail-row"><span>Seuil Pari All-In</span><strong>' + j.seuilAllIn + ' pts ' + (j.allInUtilise ? '(Utilisé)' : '(Dispo)') + '</strong></div>' +
            '<div class="detail-row"><span>Jetons / Jauge X Francs</span><strong>⚡ ' + j.jetons + '/2 • 🎯 ' + (j.jetonMaitriseObtenu ? 'Obtenu' : (j.cransMaitrise + '/3')) + '</strong></div>'
          : '') +
      '</div>';
    };

    ouvrirModale(
      '<h2>📊 Détails du combat</h2>' +
      '<p class="muted small mb-12">Mode : <strong>' + (match.modeJeu === 'complet' ? 'Complet Codex v12.0' : 'Découverte') + '</strong> • ' +
      (match.typeDuel === 'equilibre' ? 'Duel Équilibré' : 'Duel Pur') + ' • Manche ' + match.manche + ' / Volée ' + match.volee + '</p>' +
      buildJoueurBloc(j0) +
      buildJoueurBloc(j1) +
      '<h3 class="mt-12">Historique des volées</h3>' +
      '<div class="mb-12">' + histHtml + '</div>' +
      '<button class="btn btn-ghost mb-8" id="btnToggleModeLive" type="button">' + txtSwitch + '</button>' +
      '<button class="btn btn-accent" id="btnCloseDetails" type="button">Fermer</button>'
    );

    document.getElementById('btnCloseDetails').onclick = fermerModale;
    document.getElementById('btnToggleModeLive').onclick = function () {
      M.basculerMode(state.match, autreMode);
      sauverSession();
      fermerModale();
      render();
    };
  }

  // --------------------------------------------------------------------------
  // 5. COMPOSANT PARTAGÉ : BANDEAU COMBAT ÉPURÉ (HUD)
  // --------------------------------------------------------------------------

  function htmlHUD() {
    const m = state.match;
    if (!m) return '';

    const buildFighter = function (j, idx) {
      const pct = Math.max(0, Math.min(100, Math.round((j.pv / 99) * 100)));
      const barCls = pct > 50 ? 'high' : (pct > 25 ? 'mid' : 'low');
      const armure = M.getArmureActive(j);
      const dots =
        '<span class="dot-manche ' + (j.manchesGagnees >= 1 ? 'won' : '') + '"></span>' +
        '<span class="dot-manche ' + (j.manchesGagnees >= 2 ? 'won' : '') + '"></span>';

      const substats = m.modeJeu === 'complet'
        ? '<div class="hud-substats">' +
            '<span>⚡ ' + j.jetons + '/2</span>' +
            '<span>🎯 ' + (j.jetonMaitriseObtenu ? '✓' : (j.cransMaitrise + '/3')) + '</span>' +
            '<span>🔥 ' + (j.allInUtilise ? '—' : j.seuilAllIn) + '</span>' +
          '</div>'
        : '<div class="hud-substats"><span>' + labelArme(j.arme) + '</span><span>Bilan : ' + M.getBilanManche(j) + '</span></div>';

      return '<div class="hud-p p' + idx + '">' +
        '<div class="hud-name-row">' +
          '<span class="hud-name">' + esc(j.nom) + '</span>' +
          '<span class="hud-manches" title="Manches gagnées">' + dots + '</span>' +
        '</div>' +
        '<div class="hp-bar-wrap"><div class="hp-bar ' + barCls + '" style="width:' + pct + '%"></div></div>' +
        '<div class="hud-stats">' +
          '<span class="hud-pv">' + j.pv + ' <small class="muted">PV</small></span>' +
          '<span class="hud-armor">🛡️ ' + armure + '</span>' +
        '</div>' +
        substats +
      '</div>';
    };

    return '<section class="hud">' +
      '<div class="hud-meta">' +
        '<span class="hud-tag">Manche ' + m.manche + '/3 • Volée ' + m.volee + '/3</span>' +
        '<span class="hud-tag">' + (m.modeJeu === 'complet' ? '⚡ Complet v12' : '🌱 Découverte') + '</span>' +
        '<button class="btn-chip" id="btnHudDetails" type="button" style="min-height:30px;padding:4px 9px;font-size:0.78rem;">Détails</button>' +
      '</div>' +
      '<div class="hud-fighters">' +
        buildFighter(m.joueurs[0], 0) +
        buildFighter(m.joueurs[1], 1) +
      '</div>' +
    '</section>';
  }

  function bindHUD() {
    const btn = document.getElementById('btnHudDetails');
    if (btn) btn.onclick = ouvrirModaleDetails;
  }

  // --------------------------------------------------------------------------
  // 6. RENDU DE CHAQUE ÉCRAN DU PARCOURS V0.1
  // --------------------------------------------------------------------------

  function allerA(nouvelEcran) {
    arreterChrono();
    state.screen = nouvelEcran;
    if (nouvelEcran !== 'home') {
      activerProtectionNavigation();
    }
    sauverSession();
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    const app = document.getElementById('app');
    const btnHome = document.getElementById('btnHome');
    if (btnHome) btnHome.classList.toggle('hidden', state.screen === 'home');

    switch (state.screen) {
      case 'home': renderHome(app); break;
      case 'setup': renderSetup(app); break;
      case 'warmup': renderWarmup(app); break;
      case 'prog0': renderProg(app, 0); break;
      case 'curtain': renderCurtain(app); break;
      case 'prog1': renderProg(app, 1); break;
      case 'timer': renderTimer(app); break;
      case 'scoring': renderScoring(app); break;
      case 'verify': renderVerify(app); break;
      case 'reveal': renderReveal(app); break;
      case 'fleche_ko': renderFlecheKO(app); break;
      case 'gameover': renderGameOver(app); break;
      default: renderHome(app);
    }
  }

  // --- ÉCRAN 1 : ACCUEIL ---
  function renderHome(app) {
    const saved = chargerSessionSauvee();
    let resumeHtml = '';
    if (saved && saved.match && saved.match.statut !== 'termine') {
      const m = saved.match;
      resumeHtml =
        '<div class="card card-accent">' +
          '<h3>▶ Match en cours sauvegardé</h3>' +
          '<p class="muted mb-8"><strong>' + esc(m.joueurs[0].nom) + '</strong> (' + m.joueurs[0].pv + ' PV) vs <strong>' +
            esc(m.joueurs[1].nom) + '</strong> (' + m.joueurs[1].pv + ' PV) — Manche ' + m.manche + ', Volée ' + m.volee + '</p>' +
          '<button class="btn btn-accent" id="btnResumeMatch" type="button">Reprendre exactement où on était</button>' +
        '</div>';
    }

    app.innerHTML =
      resumeHtml +
      '<div class="card center">' +
        '<div style="font-size:2.4rem;margin-bottom:4px;">🏹⚡</div>' +
        '<h1>Archery E-sport League</h1>' +
        '<p class="muted">18 m • Votre arc, 1 seul smartphone « Passe & Joue ».<br>99 PV continus, 3 manches max (15–20 min), 0 calcul mental.</p>' +
      '</div>' +

      '<div class="card">' +
        '<h2>Nouveau Duel Club</h2>' +
        '<p class="muted small mb-12">Parcours recommandé pour une première partie : <strong>Mode Découverte</strong> (Attaques + 1 Bouclier). Choisis le format :</p>' +
        '<button class="btn btn-primary mb-8" id="btnStartPurDec" type="button">⚔️ Duel Pur — Mode Découverte</button>' +
        '<button class="btn btn-ghost mb-8" id="btnStartEqDec" type="button">⚖️ Duel Équilibré — Mode Découverte</button>' +
        '<hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">' +
        '<p class="muted small center mb-8">Déjà initié(e) ou en séance de test à 18 m ?</p>' +
        '<div class="btn-row">' +
          '<button class="btn btn-accent" id="btnStartPurFull" type="button" style="font-size:0.9rem;">⚡ Duel Pur v12.0</button>' +
          '<button class="btn btn-ghost" id="btnStartEqFull" type="button" style="font-size:0.9rem;">⚖️ Équilibré v12.0</button>' +
        '</div>' +
      '</div>' +
      '<p class="muted small center mt-12">Web App V0.1 « Démo Club » • 100 % locale • 0 donnée collectée</p>';

    if (saved && document.getElementById('btnResumeMatch')) {
      document.getElementById('btnResumeMatch').onclick = function () {
        state = saved;
        activerProtectionNavigation();
        render();
      };
    }

    function lancerConfig(typeDuel, modeJeu) {
      state = creerEtatParDefaut();
      state.setup.typeDuel = typeDuel;
      state.setup.modeJeu = modeJeu;
      allerA('setup');
    }

    document.getElementById('btnStartPurDec').onclick = function () { lancerConfig('pur', 'decouverte'); };
    document.getElementById('btnStartEqDec').onclick = function () { lancerConfig('equilibre', 'decouverte'); };
    document.getElementById('btnStartPurFull').onclick = function () { lancerConfig('pur', 'complet'); };
    document.getElementById('btnStartEqFull').onclick = function () { lancerConfig('equilibre', 'complet'); };
  }

  // --- ÉCRAN 2 : CONFIGURATION DU MATCH ---
  function renderSetup(app) {
    const s = state.setup;

    const buildArmes = function (idx) {
      return '<div class="pill-group cols-3">' +
        ARMES.map(function (a) {
          const active = s.joueurs[idx].arme === a.id ? 'active' : '';
          return '<button type="button" class="pill ' + active + '" data-arme-j="' + idx + '" data-arme="' + a.id + '">' +
            '<span>' + a.label + '</span>' +
            '<span class="pill-sub">All-In ' + a.seuil + '</span>' +
          '</button>';
        }).join('') +
      '</div>';
    };

    app.innerHTML =
      '<div class="card">' +
        '<h2>Configuration du match</h2>' +
        '<div class="field">' +
          '<label>Type de duel</label>' +
          '<div class="pill-group cols-2">' +
            '<button type="button" class="pill ' + (s.typeDuel === 'pur' ? 'active' : '') + '" id="pickPur">' +
              '<span>⚔️ Duel Pur</span><span class="pill-sub">99 PV sans handicap</span>' +
            '</button>' +
            '<button type="button" class="pill ' + (s.typeDuel === 'equilibre' ? 'active' : '') + '" id="pickEq">' +
              '<span>⚖️ Duel Équilibré</span><span class="pill-sub">Calibration 9 flèches</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label>Règles actives</label>' +
          '<div class="pill-group cols-2">' +
            '<button type="button" class="pill ' + (s.modeJeu === 'decouverte' ? 'active' : '') + '" id="pickDec">' +
              '<span>🌱 Découverte</span><span class="pill-sub">Attaque + Bouclier</span>' +
            '</button>' +
            '<button type="button" class="pill ' + (s.modeJeu === 'complet' ? 'active' : '') + '" id="pickFull">' +
              '<span>⚡ Complet v12.0</span><span class="pill-sub">Jetons + Pari All-In</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card" style="border-left:4px solid var(--j1);">' +
        '<h3>Archer 1</h3>' +
        '<div class="field">' +
          '<label for="nomJ0">Prénom</label>' +
          '<input id="nomJ0" class="input" type="text" maxlength="20" placeholder="Ex : Clémence" value="' + esc(s.joueurs[0].nom) + '">' +
        '</div>' +
        '<div class="field"><label>Division d\'arme</label>' + buildArmes(0) + '</div>' +
      '</div>' +

      '<div class="card" style="border-left:4px solid var(--j2);">' +
        '<h3>Archer 2</h3>' +
        '<div class="field">' +
          '<label for="nomJ1">Prénom</label>' +
          '<input id="nomJ1" class="input" type="text" maxlength="20" placeholder="Ex : Lucas" value="' + esc(s.joueurs[1].nom) + '">' +
        '</div>' +
        '<div class="field"><label>Division d\'arme</label>' + buildArmes(1) + '</div>' +
      '</div>' +

      '<button class="btn btn-primary" id="btnToWarmup" type="button">Continuer → Échauffement</button>';

    document.getElementById('nomJ0').oninput = function (e) { s.joueurs[0].nom = e.target.value; };
    document.getElementById('nomJ1').oninput = function (e) { s.joueurs[1].nom = e.target.value; };

    document.getElementById('pickPur').onclick = function () { s.typeDuel = 'pur'; render(); };
    document.getElementById('pickEq').onclick = function () { s.typeDuel = 'equilibre'; render(); };
    document.getElementById('pickDec').onclick = function () { s.modeJeu = 'decouverte'; render(); };
    document.getElementById('pickFull').onclick = function () { s.modeJeu = 'complet'; render(); };

    app.querySelectorAll('[data-arme-j]').forEach(function (btn) {
      btn.onclick = function () {
        const jIdx = Number(btn.getAttribute('data-arme-j'));
        s.joueurs[jIdx].arme = btn.getAttribute('data-arme');
        render();
      };
    });

    document.getElementById('btnToWarmup').onclick = function () {
      if (!s.joueurs[0].nom.trim()) s.joueurs[0].nom = 'Archer 1';
      if (!s.joueurs[1].nom.trim()) s.joueurs[1].nom = 'Archer 2';
      allerA('warmup');
    };
  }

  // --- ÉCRAN 3 : ÉCHAUFFEMENT (≥ 3 VOLÉES) & CALIBRATION EXPRESS ---
  function renderWarmup(app) {
    const s = state.setup;
    const n0 = s.joueurs[0].nom;
    const n1 = s.joueurs[1].nom;

    let calibHtml = '';
    let peutLancer = s.echauffementValide;

    if (s.typeDuel === 'equilibre') {
      let tot0 = null;
      let tot1 = null;

      if (s.calibMode === 'guidee') {
        const sumArr = function (arr) {
          return arr.reduce(function (acc, code) { return acc + M.normaliserFleche(code).valeur; }, 0);
        };
        if (s.calibFleches[0].length === 9) tot0 = sumArr(s.calibFleches[0]);
        if (s.calibFleches[1].length === 9) tot1 = sumArr(s.calibFleches[1]);

        const actif = s.calibJoueurActif;
        const arrActif = s.calibFleches[actif];
        const slotsHtml = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) {
          const val = arrActif[i];
          const cls = val ? classeCouleurFleche(val) : '';
          const activeCls = i === arrActif.length ? 'active-slot' : '';
          return '<div class="arrow-slot ' + cls + ' ' + activeCls + '">' + (val || (i + 1)) + '</div>';
        }).join('');

        calibHtml =
          '<div class="card">' +
            '<h3>🎯 Calibration Express (3 volées = 9 flèches)</h3>' +
            '<p class="muted small mb-8">Distance strictement identique au match (10 m, 15 m ou 18 m). X Franc = 12 pts.</p>' +
            '<div class="pill-group cols-2 mb-12">' +
              '<button type="button" class="pill active" id="tabCalibGuidee">Saisie 9 flèches</button>' +
              '<button type="button" class="pill" id="tabCalibRapide">Saisie rapide (total)</button>' +
            '</div>' +
            '<div class="pill-group cols-2 mb-12">' +
              '<button type="button" class="pill ' + (actif === 0 ? 'active' : '') + '" id="selCalibJ0">' +
                '<span>' + esc(n0) + '</span>' +
                '<span class="pill-sub">' + s.calibFleches[0].length + '/9 flèches (' + sumArr(s.calibFleches[0]) + ' pts)</span>' +
              '</button>' +
              '<button type="button" class="pill ' + (actif === 1 ? 'active' : '') + '" id="selCalibJ1">' +
                '<span>' + esc(n1) + '</span>' +
                '<span class="pill-sub">' + s.calibFleches[1].length + '/9 flèches (' + sumArr(s.calibFleches[1]) + ' pts)</span>' +
              '</button>' +
            '</div>' +
            '<div class="calib-grid mb-12">' + slotsHtml + '</div>' +
            '<div class="wa-pad">' +
              WA_KEYS.map(function (k) {
                return '<button type="button" class="wa-key ' + k.cls + '" data-calib-key="' + k.code + '">' +
                  '<span>' + k.code + '</span>' + (k.sub ? '<small>' + k.sub + '</small>' : '') +
                '</button>';
              }).join('') +
            '</div>' +
            '<button type="button" class="btn btn-ghost mt-8" id="btnCalibBack">⌫ Effacer dernière flèche</button>' +
          '</div>';
      } else {
        const p0 = parseInt(s.calibTotaux[0], 10);
        const p1 = parseInt(s.calibTotaux[1], 10);
        if (!isNaN(p0) && p0 >= 0 && p0 <= 108) tot0 = p0;
        if (!isNaN(p1) && p1 >= 0 && p1 <= 108) tot1 = p1;

        calibHtml =
          '<div class="card">' +
            '<h3>🎯 Calibration Express — Saisie rapide</h3>' +
            '<p class="muted small mb-8">Saisis le total connu sur 9 flèches (0 à 108 pts, X = 12).</p>' +
            '<div class="pill-group cols-2 mb-12">' +
              '<button type="button" class="pill" id="tabCalibGuidee">Saisie 9 flèches</button>' +
              '<button type="button" class="pill active" id="tabCalibRapide">Saisie rapide (total)</button>' +
            '</div>' +
            '<div class="btn-row">' +
              '<div class="field">' +
                '<label for="inCalib0">' + esc(n0) + ' (0–108)</label>' +
                '<input id="inCalib0" class="input" type="number" min="0" max="108" inputmode="numeric" value="' + esc(s.calibTotaux[0]) + '">' +
              '</div>' +
              '<div class="field">' +
                '<label for="inCalib1">' + esc(n1) + ' (0–108)</label>' +
                '<input id="inCalib1" class="input" type="number" min="0" max="108" inputmode="numeric" value="' + esc(s.calibTotaux[1]) + '">' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      calibHtml += '<div id="calibPreviewBox">';
      if (tot0 !== null && tot1 !== null) {
        const ecart = Math.abs(tot0 - tot1);
        const armure = Math.min(ecart, M.CONSTANTES.ARMURE_EQUILIBRAGE_MAX);
        const benef = tot0 < tot1 ? n0 : (tot1 < tot0 ? n1 : null);
        const s0 = M.calculerSeuilAllIn(s.joueurs[0].arme, 'equilibre', tot0);
        const s1 = M.calculerSeuilAllIn(s.joueurs[1].arme, 'equilibre', tot1);

        calibHtml +=
          '<div class="card ' + (ecart > 30 ? 'card-warn' : 'card-accent') + '">' +
            '<h3>⚖️ Résultat Calibration</h3>' +
            '<p class="mb-8">' +
              (benef
                ? '<strong>' + esc(benef) + '</strong> reçoit <strong>+' + armure + ' d\'Armure d\'Équilibrage</strong> par manche.'
                : 'Égalité parfaite : <strong>0 point</strong> d\'Armure d\'Équilibrage.') +
            '</p>' +
            (ecart > 30
              ? '<p class="small mb-8">⚠️ Écart de ' + ecart + ' pts (plafonné à 30 pts/manche). Conseil Codex : rapprocher l\'archer débutant à 15 m ou 10 m.</p>'
              : '') +
            '<p class="muted small">Seuils Pari All-In perso : ' + esc(n0) + ' = <strong>' + s0 + ' pts</strong> • ' + esc(n1) + ' = <strong>' + s1 + ' pts</strong></p>' +
          '</div>';
      } else {
        peutLancer = false;
      }
      calibHtml += '</div>';
    }

    app.innerHTML =
      '<div class="card">' +
        '<h2>1. Échauffement obligatoire</h2>' +
        '<p class="muted mb-12">Règle club AEL : chaque archer doit tirer <strong>au moins 3 volées d\'échauffement</strong> avant de démarrer le duel' +
          (s.typeDuel === 'equilibre' ? ' et la Calibration Express' : '') + '.</p>' +
        '<div id="btnToggleWarmup" class="check-card ' + (s.echauffementValide ? 'checked' : '') + '" role="checkbox" aria-checked="' + s.echauffementValide + '">' +
          '<span class="check-box">' + (s.echauffementValide ? '✓' : '') + '</span>' +
          '<span>Oui, nous avons tiré nos 3 volées d\'échauffement</span>' +
        '</div>' +
      '</div>' +
      calibHtml +
      '<div class="btn-row mt-12">' +
        '<button class="btn btn-ghost" id="btnBackSetup" type="button">← Retour</button>' +
        '<button class="btn btn-primary" id="btnLaunchMatch" type="button" ' + (peutLancer ? '' : 'disabled') + '>🏹 Lancer le Duel !</button>' +
      '</div>';

    document.getElementById('btnToggleWarmup').onclick = function () {
      s.echauffementValide = !s.echauffementValide;
      render();
    };
    document.getElementById('btnBackSetup').onclick = function () { allerA('setup'); };

    if (s.typeDuel === 'equilibre') {
      document.getElementById('tabCalibGuidee').onclick = function () { s.calibMode = 'guidee'; render(); };
      document.getElementById('tabCalibRapide').onclick = function () { s.calibMode = 'rapide'; render(); };

      if (s.calibMode === 'guidee') {
        document.getElementById('selCalibJ0').onclick = function () { s.calibJoueurActif = 0; render(); };
        document.getElementById('selCalibJ1').onclick = function () { s.calibJoueurActif = 1; render(); };
        app.querySelectorAll('[data-calib-key]').forEach(function (btn) {
          btn.onclick = function () {
            const code = btn.getAttribute('data-calib-key');
            const arr = s.calibFleches[s.calibJoueurActif];
            if (arr.length < 9) {
              arr.push(code);
              if (arr.length === 9 && s.calibJoueurActif === 0 && s.calibFleches[1].length < 9) {
                s.calibJoueurActif = 1;
              }
              render();
            }
          };
        });
        document.getElementById('btnCalibBack').onclick = function () {
          const arr = s.calibFleches[s.calibJoueurActif];
          if (arr.length > 0) {
            arr.pop();
            render();
          }
        };
      } else {
        const majCalibRapide = function () {
          const p0 = parseInt(s.calibTotaux[0], 10);
          const p1 = parseInt(s.calibTotaux[1], 10);
          const ok = !isNaN(p0) && p0 >= 0 && p0 <= 108 && !isNaN(p1) && p1 >= 0 && p1 <= 108;
          const btnL = document.getElementById('btnLaunchMatch');
          if (btnL) btnL.disabled = !(s.echauffementValide && ok);
          const prev = document.getElementById('calibPreviewBox');
          if (prev) {
            if (!ok) {
              prev.innerHTML = '';
            } else {
              const ecart = Math.abs(p0 - p1);
              const armure = Math.min(ecart, M.CONSTANTES.ARMURE_EQUILIBRAGE_MAX);
              const benef = p0 < p1 ? n0 : (p1 < p0 ? n1 : null);
              const s0 = M.calculerSeuilAllIn(s.joueurs[0].arme, 'equilibre', p0);
              const s1 = M.calculerSeuilAllIn(s.joueurs[1].arme, 'equilibre', p1);
              prev.innerHTML =
                '<div class="card ' + (ecart > 30 ? 'card-warn' : 'card-accent') + '">' +
                  '<h3>⚖️ Résultat Calibration</h3>' +
                  '<p class="mb-8">' +
                    (benef
                      ? '<strong>' + esc(benef) + '</strong> reçoit <strong>+' + armure + ' d\'Armure d\'Équilibrage</strong> par manche.'
                      : 'Égalité parfaite : <strong>0 point</strong> d\'Armure d\'Équilibrage.') +
                  '</p>' +
                  (ecart > 30
                    ? '<p class="small mb-8">⚠️ Écart de ' + ecart + ' pts (plafonné à 30 pts/manche). Conseil Codex : rapprocher l\'archer débutant à 15 m ou 10 m.</p>'
                    : '') +
                  '<p class="muted small">Seuils Pari All-In perso : ' + esc(n0) + ' = <strong>' + s0 + ' pts</strong> • ' + esc(n1) + ' = <strong>' + s1 + ' pts</strong></p>' +
                '</div>';
            }
          }
        };
        document.getElementById('inCalib0').oninput = function (e) { s.calibTotaux[0] = e.target.value; majCalibRapide(); };
        document.getElementById('inCalib1').oninput = function (e) { s.calibTotaux[1] = e.target.value; majCalibRapide(); };
      }
    }

    document.getElementById('btnLaunchMatch').onclick = function () {
      let c0 = 0, c1 = 0;
      if (s.typeDuel === 'equilibre') {
        if (s.calibMode === 'guidee') {
          c0 = s.calibFleches[0];
          c1 = s.calibFleches[1];
        } else {
          c0 = parseInt(s.calibTotaux[0], 10);
          c1 = parseInt(s.calibTotaux[1], 10);
        }
      }
      state.match = M.creerMatch({
        modeJeu: s.modeJeu,
        typeDuel: s.typeDuel,
        joueurs: [
          { nom: s.joueurs[0].nom, arme: s.joueurs[0].arme, calibration: c0 },
          { nom: s.joueurs[1].nom, arme: s.joueurs[1].arme, calibration: c1 }
        ]
      });
      reinitialiserVoleeUI();
      allerA('prog0');
    };
  }

  function reinitialiserVoleeUI() {
    state.prog = [
      { bouclier: null, jeton: null, allIn: false },
      { bouclier: null, jeton: null, allIn: false }
    ];
    state.scoring = { fleches: [[], []], curJoueur: 0, curSlot: 0 };
    state.rapport = null;
    state.revealStep = 1;
  }

  // --- ÉCRANS 4 & 6 : PROGRAMMATION SECRÈTE (J1 PUIS J2) ---
  function renderProg(app, idx) {
    const m = state.match;
    const j = m.joueurs[idx];
    const p = state.prog[idx];
    const estComplet = m.modeJeu === 'complet';
    const hasJeton = estComplet && j.jetons > 0;

    const nomsLignes = ['Flèche 1 (la plus forte)', 'Flèche 2 (intermédiaire)', 'Flèche 3 (la plus faible)'];

    const lignesHtml = [0, 1, 2].map(function (l) {
      const isShield = p.bouclier === l;
      const isSur = p.jeton && p.jeton.ligne === l && p.jeton.type === 'surcharge';
      const isBrise = p.jeton && p.jeton.ligne === l && p.jeton.type === 'brise_garde';

      let lineCls = '';
      let roleLabel = '⚔️ Attaque';
      if (p.allIn) { lineCls = 'is-allin'; roleLabel = '🔥 Attaque All-In'; }
      else if (isShield) { lineCls = 'is-shield'; roleLabel = '🛡️ Bouclier'; }
      else if (isSur) { lineCls = 'is-token'; roleLabel = '⚡ Surcharge ×2'; }
      else if (isBrise) { lineCls = 'is-token'; roleLabel = '💥 Brise-Garde'; }

      return '<div class="prog-line ' + lineCls + '">' +
        '<div class="prog-line-top">' +
          '<strong>' + nomsLignes[l] + '</strong>' +
          '<span class="prog-role-badge">' + roleLabel + '</span>' +
        '</div>' +
        '<div class="prog-btns">' +
          '<button type="button" class="mini-btn ' + (isShield ? 'active-shield' : '') + '" data-act="shield" data-l="' + l + '" ' + (p.allIn ? 'disabled' : '') + '>🛡️ Bouclier</button>' +
          (hasJeton
            ? '<button type="button" class="mini-btn ' + (isSur ? 'active-token' : '') + '" data-act="surcharge" data-l="' + l + '" ' + (p.allIn ? 'disabled' : '') + '>⚡ ×2</button>' +
              '<button type="button" class="mini-btn ' + (isBrise ? 'active-token' : '') + '" data-act="brise_garde" data-l="' + l + '" ' + (p.allIn ? 'disabled' : '') + '>💥 Brise</button>'
            : '') +
        '</div>' +
      '</div>';
    }).join('');

    let allInHtml = '';
    if (estComplet) {
      if (j.allInUtilise) {
        allInHtml = '<div class="allin-box" style="opacity:0.5;"><strong class="small">🔥 Pari Mode All-In : déjà utilisé sur ce match.</strong></div>';
      } else {
        allInHtml =
          '<div class="allin-box ' + (p.allIn ? 'active' : '') + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
              '<div>' +
                '<strong>🔥 Pari « Mode All-In » (1×/match)</strong>' +
                '<div class="small muted">Seuil : <strong>' + j.seuilAllIn + ' pts</strong> • Réussi : +15 PV directs | Raté : attaques ÷2 & -5 PV</div>' +
              '</div>' +
              '<button type="button" class="btn ' + (p.allIn ? 'btn-warn' : 'btn-ghost') + '" id="btnToggleAllIn" style="width:auto;min-height:42px;padding:8px 12px;">' +
                (p.allIn ? 'ACTIF ✓' : 'Activer') +
              '</button>' +
            '</div>' +
          '</div>';
      }
    }

    const txtLock = idx === 0
      ? '🔒 Verrouiller mes choix'
      : '🔒 Verrouiller & Passer au pas de tir';

    app.innerHTML =
      htmlHUD() +
      '<div class="card" style="border-top:4px solid var(' + (idx === 0 ? '--j1' : '--j2') + ');">' +
        '<h2 style="margin-bottom:4px;">🕵️ Programmation secrète — ' + esc(j.nom) + '</h2>' +
        '<p class="muted small mb-12">Choisis ton Bouclier (0 ou 1 max)' +
          (hasJeton ? ', et éventuellement 1 Jeton Spécial (' + j.jetons + ' dispo)' : '') +
          '. Cache bien l\'écran !</p>' +
        lignesHtml +
        allInHtml +
        '<button type="button" class="btn btn-primary mt-8" id="btnLockProg">' + txtLock + '</button>' +
      '</div>';

    bindHUD();

    app.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.onclick = function () {
        if (p.allIn) return;
        const act = btn.getAttribute('data-act');
        const l = Number(btn.getAttribute('data-l'));
        if (act === 'shield') {
          p.bouclier = (p.bouclier === l) ? null : l;
          if (p.jeton && p.jeton.ligne === p.bouclier) p.jeton = null;
        } else {
          if (p.jeton && p.jeton.ligne === l && p.jeton.type === act) {
            p.jeton = null;
          } else {
            p.jeton = { type: act, ligne: l };
            if (p.bouclier === l) p.bouclier = null;
          }
        }
        render();
      };
    });

    const btnAllIn = document.getElementById('btnToggleAllIn');
    if (btnAllIn) {
      btnAllIn.onclick = function () {
        p.allIn = !p.allIn;
        if (p.allIn) {
          p.bouclier = null;
          p.jeton = null;
        }
        render();
      };
    }

    document.getElementById('btnLockProg').onclick = function () {
      const check = M.validerProgrammation(m, idx, p);
      if (!check.valide) {
        afficherAlerteRapide(check.erreur);
        return;
      }
      state.prog[idx] = check.propre;
      if (idx === 0) {
        allerA('curtain');
      } else {
        reinitialiserChrono(false);
        allerA('timer');
      }
    };
  }

  // --- ÉCRAN 5 : ÉCRAN-RIDEAU OPAQUE BLINDÉ ---
  function renderCurtain(app) {
    const m = state.match;
    app.innerHTML =
      '<div class="curtain-screen">' +
        '<div class="curtain-icon">🔒</div>' +
        '<h1>Choix de ' + esc(m.joueurs[0].nom) + ' verrouillés</h1>' +
        '<p class="muted mt-8 mb-12">Les choix tactiques sont masqués et irréversibles.<br><strong>Passe le téléphone à ' + esc(m.joueurs[1].nom) + '</strong>.</p>' +
        '<button class="btn btn-accent mt-16" id="btnOpenProg1" type="button">Je suis ' + esc(m.joueurs[1].nom) + ' — Programmer mes choix</button>' +
      '</div>';

    document.getElementById('btnOpenProg1').onclick = function () {
      allerA('prog1');
    };
  }

  // --- ÉCRAN 7 : PAS DE TIR & CHRONOMÈTRE MANUEL ---
  function renderTimer(app) {
    app.innerHTML =
      htmlHUD() +
      '<div class="card center">' +
        '<p class="muted small mb-8">Gardez le téléphone avec vous derrière la ligne. Lancez le chrono une fois installés (ou utilisez le feu de la salle).</p>' +
        '<div id="chronoPanel" class="chrono-panel">' +
          '<div id="chronoStatus" class="chrono-status">Prêt derrière la ligne (15 s + 90 s)</div>' +
          '<div id="chronoDigits" class="chrono-digits">0:15</div>' +
        '</div>' +
        '<button class="btn btn-primary mb-8" id="btnChronoStart" type="button">▶ Lancer le chrono (15 s + 90 s)</button>' +
        '<div class="btn-row mb-12">' +
          '<button class="btn btn-ghost" id="btnChronoPause" type="button" disabled>⏸ Pause</button>' +
          '<button class="btn btn-ghost" id="btnToggleMute" type="button">' + (prefs.muet ? '🔇 Muet' : '🔊 Son actif') + '</button>' +
        '</div>' +
        '<button class="btn btn-accent" id="btnGoScoring" type="button">🎯 Saisir les scores en cible</button>' +
      '</div>';

    bindHUD();
    mettreAJourAffichageChrono();

    document.getElementById('btnChronoStart').onclick = function () { demarrerChrono(false); };
    document.getElementById('btnChronoPause').onclick = basculerPauseChrono;
    document.getElementById('btnToggleMute').onclick = function () {
      prefs.muet = !prefs.muet;
      sauverPrefs();
      document.getElementById('btnToggleMute').textContent = prefs.muet ? '🔇 Muet' : '🔊 Son actif';
    };
    document.getElementById('btnGoScoring').onclick = function () {
      allerA('scoring');
    };
  }

  // --- ÉCRAN 8 : SAISIE DES FLÈCHES CÔTE À CÔTE (PAVÉ WA < 5 s) ---
  function renderScoring(app) {
    const m = state.match;
    const sc = state.scoring;

    const buildPlayerBox = function (idx) {
      const arr = sc.fleches[idx];
      const actif = sc.curJoueur === idx;
      const tot = arr.reduce(function (a, c) { return a + (c ? M.normaliserFleche(c).valeur : 0); }, 0);
      const slots = [0, 1, 2].map(function (sIdx) {
        const val = arr[sIdx] || '';
        const cls = val ? classeCouleurFleche(val) : '';
        const sel = (actif && sc.curSlot === sIdx) ? 'active-slot' : '';
        return '<button type="button" class="arrow-slot ' + cls + ' ' + sel + '" data-slot-j="' + idx + '" data-slot-i="' + sIdx + '">' +
          (val || '·') + '</button>';
      }).join('');

      return '<div class="player-slots ' + (actif ? 'active-player' : '') + '">' +
        '<div class="player-slots-title">' +
          '<span style="color:var(' + (idx === 0 ? '--j1' : '--j2') + ');">' + esc(m.joueurs[idx].nom) + '</span>' +
          '<span>' + tot + ' pts</span>' +
        '</div>' +
        '<div class="arrow-slots">' + slots + '</div>' +
      '</div>';
    };

    const complet0 = sc.fleches[0].filter(Boolean).length === 3;
    const complet1 = sc.fleches[1].filter(Boolean).length === 3;
    const pret = complet0 && complet1;

    app.innerHTML =
      htmlHUD() +
      '<div class="slots-grid">' + buildPlayerBox(0) + buildPlayerBox(1) + '</div>' +
      '<div class="card" style="padding:12px;">' +
        '<div class="muted small center mb-8">Saisie pour <strong>' + esc(m.joueurs[sc.curJoueur].nom) + '</strong> — Flèche ' + (sc.curSlot + 1) + '/3 (tri décroissant auto)</div>' +
        '<div class="wa-pad">' +
          WA_KEYS.map(function (k) {
            return '<button type="button" class="wa-key ' + k.cls + '" data-wa="' + k.code + '">' +
              '<span>' + k.code + '</span>' + (k.sub ? '<small>' + k.sub + '</small>' : '') +
            '</button>';
          }).join('') +
        '</div>' +
        '<div class="btn-row mt-12">' +
          '<button type="button" class="btn btn-ghost" id="btnEraseArrow">⌫ Effacer</button>' +
          '<button type="button" class="btn btn-primary" id="btnToVerify" ' + (pret ? '' : 'disabled') + '>Vérifier à deux →</button>' +
        '</div>' +
      '</div>';

    bindHUD();

    app.querySelectorAll('[data-slot-j]').forEach(function (el) {
      el.onclick = function () {
        sc.curJoueur = Number(el.getAttribute('data-slot-j'));
        sc.curSlot = Number(el.getAttribute('data-slot-i'));
        render();
      };
    });

    app.querySelectorAll('[data-wa]').forEach(function (el) {
      el.onclick = function () {
        const code = el.getAttribute('data-wa');
        sc.fleches[sc.curJoueur][sc.curSlot] = code;

        // Avance automatiquement au prochain emplacement vide (fluidité < 5 s)
        if (sc.curSlot < 2) {
          sc.curSlot += 1;
        } else if (sc.curJoueur === 0 && sc.fleches[1].filter(Boolean).length < 3) {
          sc.curJoueur = 1;
          const firstEmpty = [0, 1, 2].find(function (i) { return !sc.fleches[1][i]; });
          sc.curSlot = firstEmpty !== undefined ? firstEmpty : 0;
        }
        render();
      };
    });

    document.getElementById('btnEraseArrow').onclick = function () {
      if (sc.fleches[sc.curJoueur][sc.curSlot]) {
        sc.fleches[sc.curJoueur][sc.curSlot] = undefined;
      } else if (sc.curSlot > 0) {
        sc.curSlot -= 1;
        sc.fleches[sc.curJoueur][sc.curSlot] = undefined;
      } else if (sc.curJoueur === 1) {
        sc.curJoueur = 0;
        sc.curSlot = 2;
        sc.fleches[0][2] = undefined;
      }
      render();
    };

    document.getElementById('btnToVerify').onclick = function () {
      if (!pret) return;
      allerA('verify');
    };
  }

  // --- ÉCRAN 9 : VALIDATION À DEUX AVANT RÉVÉLATION ---
  function renderVerify(app) {
    const m = state.match;
    const t0 = M.trierVolee(state.scoring.fleches[0]);
    const t1 = M.trierVolee(state.scoring.fleches[1]);

    const buildRecap = function (nom, tri, colorVar) {
      const total = tri[0].valeur + tri[1].valeur + tri[2].valeur;
      const pills = tri.map(function (f) {
        return '<span class="score-pill ' + classeCouleurFleche(f.code) + '">' + f.code + '</span>';
      }).join(' ');
      return '<div class="card" style="padding:12px;border-left:4px solid var(' + colorVar + ');">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<strong>' + esc(nom) + '</strong>' +
          '<strong>Total : ' + total + ' pts</strong>' +
        '</div>' +
        '<div class="mt-8" style="display:flex;gap:8px;">' + pills + '</div>' +
      '</div>';
    };

    app.innerHTML =
      htmlHUD() +
      '<div class="card">' +
        '<h2>🤝 Validation à deux</h2>' +
        '<p class="muted small mb-12">Vérifiez ensemble les 6 flèches (triées de la plus forte à la plus faible) <strong>avant d\'arracher les flèches du blason</strong>.</p>' +
        buildRecap(m.joueurs[0].nom, t0, '--j1') +
        buildRecap(m.joueurs[1].nom, t1, '--j2') +
        '<div class="btn-row mt-12">' +
          '<button type="button" class="btn btn-ghost" id="btnEditScores">✏️ Modifier</button>' +
          '<button type="button" class="btn btn-primary" id="btnRevealNow">⚡ Révéler !</button>' +
        '</div>' +
      '</div>';

    bindHUD();

    document.getElementById('btnEditScores').onclick = function () { allerA('scoring'); };
    document.getElementById('btnRevealNow').onclick = function () {
      state.rapport = M.resoudreVolee(
        state.match,
        state.prog[0],
        state.prog[1],
        state.scoring.fleches[0],
        state.scoring.fleches[1]
      );
      state.revealStep = 1;
      allerA('reveal');
    };
  }

  // --- ÉCRAN 10 : RÉVÉLATION ÉTAPE PAR ÉTAPE + BOUTON TOUT VOIR + CORRIGER ---
  function renderReveal(app) {
    const m = state.match;
    const r = state.rapport;
    const j0 = m.joueurs[0];
    const j1 = m.joueurs[1];

    const hasAllIn = r.allIn[0].actif || r.allIn[1].actif;
    const maxSteps = hasAllIn ? 5 : 4; // L1, L2, L3, [All-In], Bilan Armures & PV
    const step = Math.min(state.revealStep, maxSteps);

    let cardsHtml = '';

    // Étapes 1, 2, 3 : Lignes 1 à 3
    for (let l = 0; l < Math.min(step, 3); l++) {
      const lig = r.lignes[l];
      cardsHtml +=
        '<div class="reveal-card">' +
          '<div class="small muted" style="font-weight:800;">LIGNE ' + lig.ligne + '</div>' +
          '<div class="reveal-duel">' +
            '<div>' +
              '<span class="score-pill ' + classeCouleurFleche(lig.fleches[0].code) + '">' + lig.fleches[0].code + '</span>' +
              '<div class="small mt-8">' + libelleRole(lig.roles[0]) + '</div>' +
            '</div>' +
            '<strong class="muted">VS</strong>' +
            '<div>' +
              '<span class="score-pill ' + classeCouleurFleche(lig.fleches[1].code) + '">' + lig.fleches[1].code + '</span>' +
              '<div class="small mt-8">' + libelleRole(lig.roles[1]) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="center small" style="font-weight:800;margin-top:6px;">' + esc(lig.resume) + '</div>' +
        '</div>';
    }

    // Étape 4 (si All-In actif) : Résolution du Pari All-In
    if (hasAllIn && step >= 4) {
      let aiLines = '';
      for (let i = 0; i < 2; i++) {
        if (r.allIn[i].actif) {
          const ok = r.allIn[i].reussi;
          aiLines += '<div class="mb-8"><strong>' + esc(m.joueurs[i].nom) + '</strong> : ' +
            r.allIn[i].totalNaturel + ' / ' + r.allIn[i].seuil + ' pts → ' +
            (ok ? '<span style="color:var(--primary);font-weight:900;">RÉUSSI ! (+15 PV directs)</span>'
                : '<span style="color:var(--danger);font-weight:900;">RATÉ ! (attaques ÷2 & -5 PV directs)</span>') +
          '</div>';
        }
      }
      cardsHtml += '<div class="reveal-card card-warn"><div class="small" style="font-weight:900;margin-bottom:4px;">🔥 PARI MODE ALL-IN</div>' + aiLines + '</div>';
    }

    // Dernière étape : Bilan de volée, Armures, PV & Fin de manche éventuelle
    if (step >= maxSteps) {
      let maitriseNotes = '';
      for (let i = 0; i < 2; i++) {
        r.evenementsMaitrise[i].forEach(function (ev) {
          maitriseNotes += '<div class="small" style="color:var(--gold);font-weight:800;">🎯 ' + esc(m.joueurs[i].nom) + ' : 3 X Francs → ' +
            (ev.surplusConverti ? '+3 Rempart (surplus Jeton) !' : '+1 Jeton de Maîtrise !') + '</div>';
        });
      }

      let finHtml = '';
      if (r.finManche) {
        const fm = r.finManche;
        if (fm.evenement === 'manche_terminee') {
          const gNom = m.joueurs[fm.gagnantManche].nom;
          const dotTxt = (fm.dotations || []).map(function (d) {
            const pNom = m.joueurs[d.joueur].nom;
            if (d.type === 'souffle_victoire') return '• ' + esc(pNom) + ' : +5 Souffle de Victoire (Manche 2)';
            if (d.surplusConverti) return '• ' + esc(pNom) + ' : surplus Jeton converti en +3 Rempart !';
            return '• ' + esc(pNom) + ' : +1 Jeton Spécial (' + (d.source === 'adrenaline_m3' ? 'Adrénaline M3' : 'Comeback') + ')';
          }).join('<br>');

          finHtml =
            '<div class="reveal-card card-accent">' +
              '<h3>🏁 Fin de la Manche ' + fm.mancheTerminee + '</h3>' +
              '<p class="mb-8"><strong>' + esc(gNom) + ' remporte la manche !</strong> (Bilan : ' +
                esc(j0.nom) + ' ' + fm.bilans[0] + ' vs ' + esc(j1.nom) + ' ' + fm.bilans[1] + ')</p>' +
              (fm.nouvelleManche === 3 ? '<p class="small mb-8">⚡ <strong>Manche 3 décisive (1–1) :</strong> 0 Souffle de Victoire gratuit !</p>' : '') +
              (dotTxt ? '<div class="small muted">' + dotTxt + '</div>' : '') +
            '</div>';
        } else if (fm.evenement === 'ko' || fm.evenement === 'auto_ko') {
          finHtml = '<div class="reveal-card card-danger center"><h2>💥 K.O. IMMÉDIAT !</h2><p><strong>' +
            esc(m.joueurs[fm.vainqueur].nom) + '</strong> remporte le match !</p></div>';
        } else if (fm.evenement === 'double_ko') {
          finHtml = '<div class="reveal-card card-danger center"><h2>💥 DOUBLE K.O. !</h2><p>Les deux archers tombent à 0 PV ensemble → <strong>Flèche de K.O. décisive</strong> !</p></div>';
        } else if (fm.evenement === 'egalite_manche_fleche_ko') {
          finHtml = '<div class="reveal-card card-warn center"><h2>⚖️ ÉGALITÉ PARFAITE !</h2><p>Bilan identique (' +
            fm.bilans[0] + ' vs ' + fm.bilans[1] + ') → <strong>Flèche de K.O.</strong> pour attribuer la manche.</p></div>';
        } else if (fm.evenement === 'victoire_match_manches') {
          finHtml = '<div class="reveal-card card-accent center"><h2>🏆 VICTOIRE AUX MANCHES !</h2><p><strong>' +
            esc(m.joueurs[fm.vainqueurMatch].nom) + '</strong> remporte le match (2 manches gagnantes) !</p></div>';
        }
      }

      cardsHtml +=
        '<div class="reveal-card">' +
          '<div class="small muted" style="font-weight:800;margin-bottom:6px;">BILAN VOLÉE M' + r.manche + 'V' + r.volee + '</div>' +
          '<div class="detail-row"><span><strong>' + esc(j0.nom) + '</strong></span><span>' + r.pvApres[0] + ' PV • 🛡️ ' + r.armureActiveApres[0] + '</span></div>' +
          '<div class="detail-row"><span><strong>' + esc(j1.nom) + '</strong></span><span>' + r.pvApres[1] + ' PV • 🛡️ ' + r.armureActiveApres[1] + '</span></div>' +
          maitriseNotes +
        '</div>' +
        finHtml;
    }

    let actionBtnHtml = '';
    if (step < maxSteps) {
      actionBtnHtml =
        '<div class="btn-row">' +
          '<button type="button" class="btn btn-primary" id="btnNextReveal">Étape suivante →</button>' +
          '<button type="button" class="btn btn-ghost" id="btnRevealAll">⏩ Tout voir</button>' +
        '</div>';
    } else if (m.statut === 'termine') {
      actionBtnHtml = '<button type="button" class="btn btn-primary" id="btnContinueAfterReveal">🏆 Voir le résultat final</button>';
    } else if (m.statut === 'fleche_ko_manche' || m.statut === 'fleche_ko_match') {
      actionBtnHtml = '<button type="button" class="btn btn-warn" id="btnContinueAfterReveal">🎯 Passer à la Flèche de K.O.</button>';
    } else {
      const labelNext = (r.finManche && r.finManche.evenement === 'manche_terminee')
        ? ('Démarrer la Manche ' + m.manche + ' →')
        : ('Volée ' + m.volee + ' — Programmation ' + esc(j0.nom) + ' →');
      actionBtnHtml = '<button type="button" class="btn btn-primary" id="btnContinueAfterReveal">' + labelNext + '</button>';
    }

    app.innerHTML =
      htmlHUD() +
      '<div class="card">' +
        '<h2>🎬 Révélation — Manche ' + r.manche + ', Volée ' + r.volee + '</h2>' +
        cardsHtml +
        '<div class="mt-12">' + actionBtnHtml + '</div>' +
        '<button type="button" class="btn-link mt-8" id="btnCorrectEnd">↩️ Erreur de frappe ? Corriger la volée (accord des 2 archers)</button>' +
      '</div>';

    bindHUD();

    const btnNext = document.getElementById('btnNextReveal');
    if (btnNext) btnNext.onclick = function () { state.revealStep += 1; sauverSession(); render(); };

    const btnAll = document.getElementById('btnRevealAll');
    if (btnAll) btnAll.onclick = function () { state.revealStep = maxSteps; sauverSession(); render(); };

    const btnCont = document.getElementById('btnContinueAfterReveal');
    if (btnCont) {
      btnCont.onclick = function () {
        if (m.statut === 'termine') {
          allerA('gameover');
        } else if (m.statut === 'fleche_ko_manche' || m.statut === 'fleche_ko_match') {
          state.flecheKO = { fleches: [null, null], curJoueur: 0, egaliteEnAttente: false, message: '' };
          reinitialiserChrono(true);
          allerA('fleche_ko');
        } else {
          reinitialiserVoleeUI();
          allerA('prog0');
        }
      };
    }

    document.getElementById('btnCorrectEnd').onclick = function () {
      ouvrirModale(
        '<h3>↩️ Corriger la dernière volée ?</h3>' +
        '<p class="muted">Confirmez à deux que les flèches sont encore en cible : les points de cette volée seront annulés pour ressaisir les scores (les choix tactiques restent verrouillés).</p>' +
        '<div class="btn-row mt-16">' +
          '<button type="button" class="btn btn-ghost" id="btnCancelCorr">Annuler</button>' +
          '<button type="button" class="btn btn-danger" id="btnConfirmCorr">Oui, corriger</button>' +
        '</div>'
      );
      document.getElementById('btnCancelCorr').onclick = fermerModale;
      document.getElementById('btnConfirmCorr').onclick = function () {
        const restaure = M.annulerDerniereVolee(state.match);
        fermerModale();
        if (restaure) {
          state.match = restaure;
          state.rapport = null;
          state.revealStep = 1;
          allerA('scoring');
        }
      };
    };
  }

  // --- ÉCRAN 11 : FLÈCHE DE K.O. (STATUT HORS COMBAT) ---
  function renderFlecheKO(app) {
    const m = state.match;
    const fk = state.flecheKO;
    const estMatch = m.statut === 'fleche_ko_match';

    const buildSlot = function (idx) {
      const val = fk.fleches[idx];
      const cls = val ? classeCouleurFleche(val) : '';
      const active = fk.curJoueur === idx ? 'active-slot' : '';
      return '<div class="player-slots ' + (fk.curJoueur === idx ? 'active-player' : '') + '">' +
        '<div class="player-slots-title"><span>' + esc(m.joueurs[idx].nom) + '</span></div>' +
        '<button type="button" class="arrow-slot ' + cls + ' ' + active + '" style="width:100%;" data-fk-j="' + idx + '">' +
          (val || '—') + '</button>' +
      '</div>';
    };

    let egaliteHtml = '';
    if (fk.egaliteEnAttente) {
      egaliteHtml =
        '<div class="card card-warn mt-12">' +
          '<h3>📏 Égalité de valeur (' + esc(fk.fleches[0]) + ' vs ' + esc(fk.fleches[1]) + ')</h3>' +
          '<p class="small mb-8">Qui est le plus proche du centre exact ? (Si indécidable sans arbitre : retirez une flèche.)</p>' +
          '<div class="btn-row mb-8">' +
            '<button type="button" class="btn btn-primary" id="btnFKClose0">' + esc(m.joueurs[0].nom) + '</button>' +
            '<button type="button" class="btn btn-primary" id="btnFKClose1">' + esc(m.joueurs[1].nom) + '</button>' +
          '</div>' +
          '<button type="button" class="btn btn-ghost" id="btnFKRetire">🔄 Indécidable → Retirer une flèche</button>' +
        '</div>';
    }

    app.innerHTML =
      htmlHUD() +
      '<div class="card">' +
        '<h2>🎯 Flèche de K.O. — ' + (estMatch ? 'Pour le MATCH entier !' : 'Pour la Manche ' + m.manche) + '</h2>' +
        '<p class="muted small mb-12">1 seule flèche chacun (30 s) • Hors combat (0 PV, 0 Maîtrise) • X Franc bat 10.</p>' +
        '<div id="chronoPanel" class="chrono-panel" style="padding:14px;">' +
          '<div id="chronoStatus" class="chrono-status">Chrono optionnel (15 s + 30 s)</div>' +
          '<div id="chronoDigits" class="chrono-digits" style="font-size:3rem;">0:15</div>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost mb-12" id="btnChronoStart">▶ Lancer chrono Flèche de K.O. (15 s + 30 s)</button>' +
        (fk.message ? '<div class="card card-warn small mb-12">' + esc(fk.message) + '</div>' : '') +
        '<div class="slots-grid">' + buildSlot(0) + buildSlot(1) + '</div>' +
        (fk.egaliteEnAttente ? egaliteHtml : (
          '<div class="wa-pad">' +
            WA_KEYS.map(function (k) {
              return '<button type="button" class="wa-key ' + k.cls + '" data-fk-wa="' + k.code + '">' +
                '<span>' + k.code + '</span>' + (k.sub ? '<small>' + k.sub + '</small>' : '') +
              '</button>';
            }).join('') +
          '</div>' +
          '<button type="button" class="btn btn-primary mt-12" id="btnValidateFK" ' + ((fk.fleches[0] && fk.fleches[1]) ? '' : 'disabled') + '>Valider la Flèche de K.O.</button>'
        )) +
      '</div>';

    bindHUD();
    mettreAJourAffichageChrono();

    document.getElementById('btnChronoStart').onclick = function () { demarrerChrono(true); };

    app.querySelectorAll('[data-fk-j]').forEach(function (el) {
      el.onclick = function () {
        fk.curJoueur = Number(el.getAttribute('data-fk-j'));
        fk.egaliteEnAttente = false;
        render();
      };
    });

    app.querySelectorAll('[data-fk-wa]').forEach(function (el) {
      el.onclick = function () {
        fk.fleches[fk.curJoueur] = el.getAttribute('data-fk-wa');
        if (fk.curJoueur === 0 && !fk.fleches[1]) fk.curJoueur = 1;
        fk.message = '';
        render();
      };
    });

    function traiterResultatFK(plusProche) {
      const res = M.resoudreFlecheKO(state.match, fk.fleches[0], fk.fleches[1], plusProche);
      if (res.retirage) {
        if (fk.fleches[0] === 'M' && fk.fleches[1] === 'M') {
          fk.fleches = [null, null];
          fk.curJoueur = 0;
          fk.egaliteEnAttente = false;
          fk.message = res.raison;
        } else {
          fk.egaliteEnAttente = true;
          fk.message = '';
        }
        render();
        return;
      }
      if (state.match.statut === 'termine') {
        allerA('gameover');
      } else {
        reinitialiserVoleeUI();
        allerA('prog0');
      }
    }

    const btnVal = document.getElementById('btnValidateFK');
    if (btnVal) btnVal.onclick = function () { traiterResultatFK(null); };

    if (fk.egaliteEnAttente) {
      document.getElementById('btnFKClose0').onclick = function () { traiterResultatFK(0); };
      document.getElementById('btnFKClose1').onclick = function () { traiterResultatFK(1); };
      document.getElementById('btnFKRetire').onclick = function () {
        fk.fleches = [null, null];
        fk.curJoueur = 0;
        fk.egaliteEnAttente = false;
        fk.message = 'Retirage lancé : saisissez la nouvelle Flèche de K.O.';
        render();
      };
    }
  }

  // --- ÉCRAN 12 : VICTOIRE / FIN DE MATCH ---
  function renderGameOver(app) {
    const m = state.match;
    const g = m.joueurs[m.vainqueur];
    const p = m.joueurs[1 - m.vainqueur];

    let motifTxt = 'Victoire aux Manches (2 manches gagnantes)';
    if (m.motifVictoire === 'ko') motifTxt = 'Victoire immédiate par K.O. (0 PV) !';
    else if (m.motifVictoire === 'auto_ko') motifTxt = 'Victoire par Auto-K.O. adverse sur Pari All-In raté !';
    else if (m.motifVictoire === 'double_ko_fleche') motifTxt = 'Victoire sur Flèche de K.O. après Double K.O. !';

    const etaitDecouverte = m.modeJeu === 'decouverte';

    app.innerHTML =
      '<div class="card card-accent center">' +
        '<div style="font-size:3.2rem;margin-bottom:6px;">🏆</div>' +
        '<h1>Victoire de ' + esc(g.nom) + ' !</h1>' +
        '<p style="font-weight:800;color:var(--accent);margin-bottom:12px;">' + motifTxt + '</p>' +
        '<div class="detail-row"><span>' + esc(g.nom) + ' (' + labelArme(g.arme) + ')</span><strong>' + g.pv + ' PV • ' + g.manchesGagnees + ' manche(s)</strong></div>' +
        '<div class="detail-row"><span>' + esc(p.nom) + ' (' + labelArme(p.arme) + ')</span><strong>' + p.pv + ' PV • ' + p.manchesGagnees + ' manche(s)</strong></div>' +
        '<div class="detail-row"><span>Volées disputées</span><strong>' + m.historique.length + ' volées (' + (m.historique.length * 3) + ' flèches)</strong></div>' +
      '</div>' +

      '<div class="card">' +
        (etaitDecouverte
          ? '<button type="button" class="btn btn-primary mb-8" id="btnRematchComplet">⚡ Revanche en Mode Complet v12.0 !</button>'
          : '') +
        '<button type="button" class="btn ' + (etaitDecouverte ? 'btn-ghost' : 'btn-primary') + ' mb-8" id="btnRematchSame">🔁 Revanche (mêmes paramètres)</button>' +
        '<button type="button" class="btn btn-ghost mb-8" id="btnEndDetails">📊 Voir les détails du match</button>' +
        '<button type="button" class="btn btn-accent" id="btnBackHome">🏠 Retour à l\'accueil</button>' +
      '</div>';

    function relancerRevanche(modeCible) {
      const j0 = m.joueurs[0];
      const j1 = m.joueurs[1];
      state.match = M.creerMatch({
        modeJeu: modeCible,
        typeDuel: m.typeDuel,
        joueurs: [
          { nom: j0.nom, arme: j0.arme, calibration: j0.calibrationTotal },
          { nom: j1.nom, arme: j1.arme, calibration: j1.calibrationTotal }
        ]
      });
      reinitialiserVoleeUI();
      allerA('prog0');
    }

    const btnFull = document.getElementById('btnRematchComplet');
    if (btnFull) btnFull.onclick = function () { relancerRevanche('complet'); };
    document.getElementById('btnRematchSame').onclick = function () { relancerRevanche(m.modeJeu); };
    document.getElementById('btnEndDetails').onclick = ouvrirModaleDetails;
    document.getElementById('btnBackHome').onclick = function () {
      effacerSessionSauvee();
      state = creerEtatParDefaut();
      allerA('home');
    };
  }

  // --------------------------------------------------------------------------
  // 7. INITIALISATION & BOUTONS DE LA BARRE SUPÉRIEURE
  // --------------------------------------------------------------------------

  appliquerTheme();

  document.getElementById('btnTheme').onclick = function () {
    prefs.soleil = !prefs.soleil;
    sauverPrefs();
    appliquerTheme();
  };

  document.getElementById('btnHome').onclick = function () {
    if (state.match && state.match.statut !== 'termine') {
      ouvrirModale(
        '<h3>🏠 Retourner à l\'accueil ?</h3>' +
        '<p class="muted">Ton match en cours reste sauvegardé sur le téléphone : tu pourras le reprendre à tout moment.</p>' +
        '<div class="btn-row mt-16">' +
          '<button type="button" class="btn btn-ghost" id="btnStay">Rester ici</button>' +
          '<button type="button" class="btn btn-accent" id="btnConfirmHome">Accueil</button>' +
        '</div>'
      );
      document.getElementById('btnStay').onclick = fermerModale;
      document.getElementById('btnConfirmHome').onclick = function () {
        fermerModale();
        sauverSession();
        arreterChrono();
        state.screen = 'home';
        render();
      };
    } else {
      state.screen = 'home';
      render();
    }
  };

  render();
})();
