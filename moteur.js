/**
 * ============================================================================
 * ARCHERY E-SPORT LEAGUE (AEL) — MOTEUR DE RÈGLES OFFICIEL (CODEX V12.0)
 * ============================================================================
 * Fichier : moteur.js (Brique 1 — Moteur de calcul pur, sans interface)
 * Budget  : 0 € | 100 % JavaScript pur (compatible navigateur mobile & hors-ligne)
 *
 * Ce fichier est "l'arbitre mathématique" de l'application :
 * - Il ne gère aucun bouton ni aucun affichage (ça, ce sera app.js + style.css).
 * - Il applique 100 % des règles certifiées du Codex Officiel v12.0 :
 *   1. X Franc = 12 pts partout, tri décroissant automatique des 3 flèches
 *   2. 99 PV continus, 3 manches max (2 manches gagnantes ou K.O. à 0 PV)
 *   3. Bilan de Manche calculé après Bouclier uniquement et AVANT absorption d'armure
 *   4. Priorité d'armure : (1) Équilibrage -> (2) Souffle M2 -> (3) Rempart conservé
 *   5. Parade Parfaite stricte (+2 Rempart si Bouclier >= 1 ET Attaque >= 1, Surcharge x2 incluse)
 *   6. Surplus de Jeton au-delà de 2 converti automatiquement en +3 Rempart (hors Bilan)
 *   7. Jauge de Maîtrise inconditionnelle (3 X Francs = +1 Jeton, max 1/match)
 *   8. Pari All-In libre dès M1V1, exclusif, seuils FFTA 2026 (34/29/26) ou Calib + 3 plafonné
 *   9. Plafond armure d'équilibrage 30 pts/manche, 0 Souffle en M3, Double K.O. -> Flèche de K.O.
 * ============================================================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AELMoteur = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. CONSTANTES OFFICIELLES DU CODEX V12.0
  // --------------------------------------------------------------------------
  const CONSTANTES = Object.freeze({
    VERSION_CODEX: '12.0',
    PV_DEPART: 99,
    MANCHES_POUR_GAGNER: 2,
    VOLEES_PAR_MANCHE: 3,
    FLECHES_PAR_VOLEE: 3,
    VALEUR_X_FRANC: 12,

    // Armures & Rempart
    ARMURE_EQUILIBRAGE_MAX: 30,
    SOUFFLE_VICTOIRE_M2: 5,
    PARADE_PARFAITE_REMPART: 2,
    CHOC_BOUCLIERS_REMPART: 1,
    SURPLUS_JETON_REMPART: 3,

    // Jetons Spéciaux & Maîtrise
    JETONS_RESERVE_MAX: 2,
    MAITRISE_CRANS_REQUIS: 3,
    MAITRISE_JETON_MAX_MATCH: 1,

    // Pari Mode All-In (Seuils fixes calibrés FFTA 2026)
    SEUILS_ALL_IN: Object.freeze({
      poulies: 34,
      classique: 29,
      arc_nu: 26
    }),
    ALL_IN_BONUS_EQUILIBRE: 3,
    ALL_IN_BONUS_PV: 15,
    ALL_IN_PENALITE_PV: 5
  });

  // --------------------------------------------------------------------------
  // 2. OUTILS DE BASE : CLONAGE, FLÈCHES & TRI DÉCROISSANT
  // --------------------------------------------------------------------------

  /**
   * Crée une copie indépendante d'un objet état (utile pour l'historique et
   * le bouton "Corriger la volée" en club sans effet de bord).
   */
  function clonerEtat(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Normalise une flèche saisie par un joueur.
   * Entrées acceptées : 'X', 'x', 12, 10..1, 'M', 'm', 0,
   * ou un objet { code: 'X'|10|'M', penaliteAnnulee: boolean }.
   */
  function normaliserFleche(entree) {
    let brut = entree;
    let penaliteAnnulee = false;

    if (entree !== null && typeof entree === 'object') {
      brut = entree.code !== undefined ? entree.code : entree.valeur;
      penaliteAnnulee = Boolean(entree.penaliteAnnulee);
    }

    if (typeof brut === 'string') {
      const propre = brut.trim().toUpperCase();
      if (propre === 'X') {
        return {
          code: 'X',
          valeurBrute: CONSTANTES.VALEUR_X_FRANC,
          valeur: penaliteAnnulee ? 0 : CONSTANTES.VALEUR_X_FRANC,
          isX: !penaliteAnnulee,
          penaliteAnnulee
        };
      }
      if (propre === 'M' || propre === '0') {
        return { code: 'M', valeurBrute: 0, valeur: 0, isX: false, penaliteAnnulee };
      }
      const num = Number(propre);
      if (Number.isInteger(num) && num >= 1 && num <= 10) {
        return {
          code: String(num),
          valeurBrute: num,
          valeur: penaliteAnnulee ? 0 : num,
          isX: false,
          penaliteAnnulee
        };
      }
      if (num === 12) {
        return {
          code: 'X',
          valeurBrute: 12,
          valeur: penaliteAnnulee ? 0 : 12,
          isX: !penaliteAnnulee,
          penaliteAnnulee
        };
      }
    } else if (typeof brut === 'number' && Number.isInteger(brut)) {
      if (brut === 12) {
        return {
          code: 'X',
          valeurBrute: 12,
          valeur: penaliteAnnulee ? 0 : 12,
          isX: !penaliteAnnulee,
          penaliteAnnulee
        };
      }
      if (brut === 0) {
        return { code: 'M', valeurBrute: 0, valeur: 0, isX: false, penaliteAnnulee };
      }
      if (brut >= 1 && brut <= 10) {
        return {
          code: String(brut),
          valeurBrute: brut,
          valeur: penaliteAnnulee ? 0 : brut,
          isX: false,
          penaliteAnnulee
        };
      }
    }

    throw new Error('Score de flèche invalide : ' + JSON.stringify(entree));
  }

  /**
   * Normalise et trie automatiquement 3 flèches par ordre décroissant
   * (Flèche 1 >= Flèche 2 >= Flèche 3).
   */
  function trierVolee(fleches) {
    if (!Array.isArray(fleches) || fleches.length !== CONSTANTES.FLECHES_PAR_VOLEE) {
      throw new Error('Une volée doit contenir exactement 3 flèches.');
    }
    return fleches
      .map(normaliserFleche)
      .sort(function (a, b) {
        if (b.valeur !== a.valeur) return b.valeur - a.valeur;
        return (b.isX ? 1 : 0) - (a.isX ? 1 : 0);
      });
  }

  /**
   * Calcule le score total d'une Calibration Express (9 flèches ou total direct)
   * ainsi que le nombre de X et de 10 (utile pour le départage officiel).
   */
  function calculerCalibration(flechesOuTotal) {
    if (typeof flechesOuTotal === 'number') {
      if (!Number.isInteger(flechesOuTotal) || flechesOuTotal < 0 || flechesOuTotal > 108) {
        throw new Error('Total de calibration invalide (doit être entre 0 et 108).');
      }
      return { total: flechesOuTotal, nbX: 0, nb10: 0 };
    }
    if (Array.isArray(flechesOuTotal) && flechesOuTotal.length === 9) {
      const normalisees = flechesOuTotal.map(normaliserFleche);
      let total = 0;
      let nbX = 0;
      let nb10 = 0;
      for (let i = 0; i < normalisees.length; i++) {
        total += normalisees[i].valeur;
        if (normalisees[i].isX) nbX++;
        else if (normalisees[i].valeur === 10) nb10++;
      }
      return { total, nbX, nb10 };
    }
    throw new Error('La calibration attend soit 9 flèches, soit un entier entre 0 et 108.');
  }

  /**
   * Calcule le seuil Pari All-In d'un joueur selon le type de duel et son arme.
   * - Duel Pur : seuil fixe FFTA 2026 (34 Poulies / 29 Classique / 26 Arc Nu)
   * - Duel Équilibré : Math.floor(calibration / 3) + 3, plafonné au seuil de l'arme
   */
  function calculerSeuilAllIn(arme, typeDuel, calibrationTotal) {
    const seuilFixe = CONSTANTES.SEUILS_ALL_IN[arme];
    if (!seuilFixe) {
      throw new Error('Division d\'arme inconnue : ' + arme);
    }
    if (typeDuel === 'equilibre') {
      const moyenneInf = Math.floor((calibrationTotal || 0) / 3);
      return Math.min(moyenneInf + CONSTANTES.ALL_IN_BONUS_EQUILIBRE, seuilFixe);
    }
    return seuilFixe;
  }

  /**
   * Retourne l'Armure Active totale affichée à l'écran (1 seul chiffre clair).
   */
  function getArmureActive(joueur) {
    return joueur.armureEquilibrage + joueur.armureSouffle + joueur.armureRempart;
  }

  /**
   * Retourne le Bilan de Manche actuel d'un joueur (Codex v12.0 — Chapitre 2.1) :
   * Dégâts nets après Bouclier AVANT armure (+ directs All-In)
   * - Rempart de combat gagné sur la manche (+2/+1 uniquement, JAMAIS surplus +3)
   * - Tranche d'Armure d'Équilibrage (1 fois par manche en Duel Équilibré, 0 sinon)
   */
  function getBilanManche(joueur) {
    return joueur.bilanMancheDegats - joueur.bilanMancheRempartGagne - joueur.trancheEquilibrage;
  }

  // --------------------------------------------------------------------------
  // 3. CRÉATION D'UN MATCH & BASCULE DÉCOUVERTE / COMPLET
  // --------------------------------------------------------------------------

  /**
   * Crée un nouvel état de match prêt à jouer.
   * @param {Object} config
   * @param {'decouverte'|'complet'} [config.modeJeu='decouverte']
   * @param {'pur'|'equilibre'} [config.typeDuel='pur']
   * @param {Array<{nom:string, arme:'poulies'|'classique'|'arc_nu', calibration?:number|Array}>} config.joueurs
   */
  function creerMatch(config) {
    const modeJeu = config && config.modeJeu === 'complet' ? 'complet' : 'decouverte';
    const typeDuel = config && config.typeDuel === 'equilibre' ? 'equilibre' : 'pur';

    if (!config || !Array.isArray(config.joueurs) || config.joueurs.length !== 2) {
      throw new Error('Un match nécessite exactement 2 joueurs.');
    }

    const calibs = config.joueurs.map(function (j) {
      if (typeDuel === 'equilibre') {
        return calculerCalibration(j.calibration !== undefined ? j.calibration : 0);
      }
      return { total: 0, nbX: 0, nb10: 0 };
    });

    const ecartBrut = typeDuel === 'equilibre' ? Math.abs(calibs[0].total - calibs[1].total) : 0;
    const armurePlafonnee = Math.min(ecartBrut, CONSTANTES.ARMURE_EQUILIBRAGE_MAX);
    const alerteRapprochement = typeDuel === 'equilibre' && ecartBrut > CONSTANTES.ARMURE_EQUILIBRAGE_MAX;

    const joueurs = config.joueurs.map(function (j, idx) {
      const arme = j.arme || 'classique';
      if (!CONSTANTES.SEUILS_ALL_IN[arme]) {
        throw new Error('Arme invalide pour ' + (j.nom || 'Joueur ' + (idx + 1)) + ' : ' + arme);
      }

      let trancheEq = 0;
      if (typeDuel === 'equilibre' && ecartBrut > 0) {
        const autreIdx = 1 - idx;
        if (calibs[idx].total < calibs[autreIdx].total) {
          trancheEq = armurePlafonnee;
        }
      }

      return {
        nom: (j.nom || ('Archer ' + (idx + 1))).trim(),
        arme: arme,
        calibrationTotal: calibs[idx].total,
        trancheEquilibrage: trancheEq,
        seuilAllIn: calculerSeuilAllIn(arme, typeDuel, calibs[idx].total),

        // État combat
        pv: CONSTANTES.PV_DEPART,
        armureEquilibrage: trancheEq,
        armureSouffle: 0,
        armureRempart: 0,
        manchesGagnees: 0,

        // Ressources tactiques (Mode Complet v12.0)
        jetons: 0,
        cransMaitrise: 0,
        jetonMaitriseObtenu: false,
        allInUtilise: false,

        // Compteurs Bilan de Manche en cours
        bilanMancheDegats: 0,
        bilanMancheRempartGagne: 0
      };
    });

    return {
      versionCodex: CONSTANTES.VERSION_CODEX,
      modeJeu: modeJeu,
      typeDuel: typeDuel,
      ecartCalibrationBrut: ecartBrut,
      alerteRapprochement: alerteRapprochement,
      manche: 1,
      volee: 1,
      statut: 'en_cours', // 'en_cours' | 'fleche_ko_manche' | 'fleche_ko_match' | 'termine'
      vainqueur: null,
      motifVictoire: null, // 'ko' | 'auto_ko' | 'manches' | 'double_ko_fleche'
      joueurs: joueurs,
      historique: [],
      dernierSnapshot: null
    };
  }

  /**
   * Bascule instantanément entre Mode Découverte et Mode Complet v12.0
   * sans perdre la partie ni bloquer les testeurs.
   */
  function basculerMode(etat, nouveauMode) {
    if (nouveauMode !== 'decouverte' && nouveauMode !== 'complet') {
      throw new Error('Mode inconnu : ' + nouveauMode);
    }
    etat.modeJeu = nouveauMode;
    return etat;
  }

  // --------------------------------------------------------------------------
  // 4. VALIDATION DE LA PROGRAMMATION SECRÈTE
  // --------------------------------------------------------------------------

  /**
   * Vérifie la légalité des choix secrets d'un joueur avant verrouillage.
   * @param {Object} etat
   * @param {0|1} idxJoueur
   * @param {{bouclier?:null|0|1|2, jeton?:null|{type:'surcharge'|'brise_garde', ligne:0|1|2}, allIn?:boolean}} choix
   */
  function validerProgrammation(etat, idxJoueur, choix) {
    const j = etat.joueurs[idxJoueur];
    const c = choix || {};
    const bouclier = c.bouclier === undefined ? null : c.bouclier;
    const jeton = c.jeton === undefined ? null : c.jeton;
    const allIn = Boolean(c.allIn);

    if (bouclier !== null && bouclier !== 0 && bouclier !== 1 && bouclier !== 2) {
      return { valide: false, erreur: 'Position de Bouclier invalide (doit être 0, 1, 2 ou null).' };
    }

    if (etat.modeJeu === 'decouverte') {
      if (allIn) {
        return { valide: false, erreur: 'Le Pari All-In est désactivé en Mode Découverte.' };
      }
      if (jeton !== null) {
        return { valide: false, erreur: 'Les Jetons Spéciaux sont désactivés en Mode Découverte.' };
      }
      return { valide: true, propre: { bouclier: bouclier, jeton: null, allIn: false } };
    }

    // Mode Complet v12.0
    if (allIn) {
      if (j.allInUtilise) {
        return { valide: false, erreur: j.nom + ' a déjà utilisé son Pari All-In dans ce match.' };
      }
      if (bouclier !== null) {
        return { valide: false, erreur: 'Pari All-In exclusif : interdit de poser un Bouclier.' };
      }
      if (jeton !== null) {
        return { valide: false, erreur: 'Pari All-In exclusif : interdit d\'utiliser un Jeton Spécial.' };
      }
      return { valide: true, propre: { bouclier: null, jeton: null, allIn: true } };
    }

    if (jeton !== null) {
      if (j.jetons < 1) {
        return { valide: false, erreur: j.nom + ' n\'a aucun Jeton Spécial en réserve.' };
      }
      if (jeton.type !== 'surcharge' && jeton.type !== 'brise_garde') {
        return { valide: false, erreur: 'Type de Jeton invalide : ' + jeton.type };
      }
      if (jeton.ligne !== 0 && jeton.ligne !== 1 && jeton.ligne !== 2) {
        return { valide: false, erreur: 'Ligne du Jeton invalide (0, 1 ou 2).' };
      }
      if (bouclier === jeton.ligne) {
        return { valide: false, erreur: 'Un Jeton Spécial doit être placé sur une flèche d\'Attaque (pas sur le Bouclier).' };
      }
      return {
        valide: true,
        propre: { bouclier: bouclier, jeton: { type: jeton.type, ligne: jeton.ligne }, allIn: false }
      };
    }

    return { valide: true, propre: { bouclier: bouclier, jeton: null, allIn: false } };
  }

  // --------------------------------------------------------------------------
  // 5. GESTION DES JETONS & CONVERSION SURPLUS (+3 REMPART HORS BILAN)
  // --------------------------------------------------------------------------

  /**
   * Ajoute un Jeton à un joueur en Mode Complet.
   * Si la réserve est déjà à 2 Jetons, convertit automatiquement en +3 Rempart
   * (crédité dans rempartSurplusPourApres si pendant une volée, ou directement si entre manches).
   */
  function attribuerJeton(joueur, source, pendantVolee) {
    if (joueur.jetons < CONSTANTES.JETONS_RESERVE_MAX) {
      joueur.jetons += 1;
      return { type: 'jeton', source: source, surplusConverti: false, rempartAjoute: 0 };
    }
    if (!pendantVolee) {
      joueur.armureRempart += CONSTANTES.SURPLUS_JETON_REMPART;
    }
    return {
      type: 'surplus_rempart',
      source: source,
      surplusConverti: true,
      rempartAjoute: CONSTANTES.SURPLUS_JETON_REMPART
    };
  }

  // --------------------------------------------------------------------------
  // 6. RÉSOLUTION OFFICIELLE D'UNE VOLÉE EN 6 ÉTAPES (CODEX V12.0 — 4.3)
  // --------------------------------------------------------------------------

  function resoudreVolee(etat, progJ0, progJ1, flechesJ0, flechesJ1) {
    if (etat.statut !== 'en_cours') {
      throw new Error('Impossible de résoudre une volée : statut actuel = ' + etat.statut);
    }

    // Validation des deux programmations secrètes
    const val0 = validerProgrammation(etat, 0, progJ0);
    if (!val0.valide) throw new Error('Programmation J1 invalide : ' + val0.erreur);
    const val1 = validerProgrammation(etat, 1, progJ1);
    if (!val1.valide) throw new Error('Programmation J2 invalide : ' + val1.erreur);

    // Sauvegarde d'un instantané avant la volée pour "Corriger la volée"
    const snapshotAvant = clonerEtat(etat);
    snapshotAvant.dernierSnapshot = null;
    etat.dernierSnapshot = snapshotAvant;

    const progs = [val0.propre, val1.propre];
    const fleches = [trierVolee(flechesJ0), trierVolee(flechesJ1)];
    const joueurs = etat.joueurs;

    // Consommation des ressources engagées sur cette volée
    for (let i = 0; i < 2; i++) {
      if (progs[i].jeton) joueurs[i].jetons -= 1;
      if (progs[i].allIn) joueurs[i].allInUtilise = true;
    }

    // --- ÉTAPE 1 : Vérification du ou des Paris All-In (après pénalités) ---
    const allInDetails = [null, null];
    for (let i = 0; i < 2; i++) {
      const totalNaturel = fleches[i][0].valeur + fleches[i][1].valeur + fleches[i][2].valeur;
      if (progs[i].allIn) {
        const reussi = totalNaturel >= joueurs[i].seuilAllIn;
        allInDetails[i] = {
          actif: true,
          totalNaturel: totalNaturel,
          seuil: joueurs[i].seuilAllIn,
          reussi: reussi
        };
      } else {
        allInDetails[i] = {
          actif: false,
          totalNaturel: totalNaturel,
          seuil: joueurs[i].seuilAllIn,
          reussi: null
        };
      }
    }

    // --- ÉTAPE 2 : Jauge de Maîtrise (X Franc inconditionnel) & Résolution des 3 Lignes ---
    const evenementsMaitrise = [[], []];
    const rempartSurplusVolee = [0, 0];

    if (etat.modeJeu === 'complet') {
      for (let i = 0; i < 2; i++) {
        for (let l = 0; l < 3; l++) {
          if (fleches[i][l].isX && !joueurs[i].jetonMaitriseObtenu) {
            joueurs[i].cransMaitrise += 1;
            if (joueurs[i].cransMaitrise >= CONSTANTES.MAITRISE_CRANS_REQUIS) {
              joueurs[i].jetonMaitriseObtenu = true;
              const gain = attribuerJeton(joueurs[i], 'maitrise', true);
              if (gain.surplusConverti) {
                rempartSurplusVolee[i] += gain.rempartAjoute;
              }
              evenementsMaitrise[i].push(gain);
            }
          }
        }
      }
    }

    const detailsLignes = [];
    const degatsFlechesNets = [0, 0]; // Dégâts subis après Bouclier, AVANT armure
    const rempartCombatGagne = [0, 0]; // +2 Parade Parfaite / +1 Choc de Boucliers

    for (let l = 0; l < 3; l++) {
      const roles = [null, null];
      const vals = [0, 0];

      for (let i = 0; i < 2; i++) {
        const f = fleches[i][l];
        if (progs[i].bouclier === l) {
          roles[i] = 'bouclier';
          vals[i] = f.valeur;
        } else if (progs[i].jeton && progs[i].jeton.ligne === l) {
          roles[i] = progs[i].jeton.type; // 'surcharge' ou 'brise_garde'
          vals[i] = roles[i] === 'surcharge' ? f.valeur * 2 : f.valeur;
        } else {
          roles[i] = 'attaque';
          const estAllInRate = allInDetails[i].actif && !allInDetails[i].reussi;
          vals[i] = estAllInRate ? Math.floor(f.valeur / 2) : f.valeur;
        }
      }

      let degatsRecus = [0, 0];
      let rempartLigne = [0, 0];
      let resume = '';

      if (roles[0] === 'bouclier' && roles[1] === 'bouclier') {
        // Choc de Boucliers
        if (vals[0] > vals[1]) {
          rempartLigne[0] = CONSTANTES.CHOC_BOUCLIERS_REMPART;
          resume = 'Choc de Boucliers : ' + joueurs[0].nom + ' gagne +1 Rempart';
        } else if (vals[1] > vals[0]) {
          rempartLigne[1] = CONSTANTES.CHOC_BOUCLIERS_REMPART;
          resume = 'Choc de Boucliers : ' + joueurs[1].nom + ' gagne +1 Rempart';
        } else {
          resume = 'Choc de Boucliers : égalité (0 Rempart)';
        }
      } else if (roles[0] === 'bouclier' || roles[1] === 'bouclier') {
        const def = roles[0] === 'bouclier' ? 0 : 1;
        const att = 1 - def;

        if (roles[att] === 'brise_garde') {
          // Brise-Garde sur la même ligne : annule 100 % du Bouclier
          degatsRecus[def] = vals[att];
          resume = 'Brise-Garde ! Bouclier de ' + joueurs[def].nom + ' fracassé (-' + vals[att] + ')';
        } else if (vals[def] >= vals[att]) {
          // Parade bloquée — vérification stricte Parade Parfaite (>= 1 ET >= 1)
          if (vals[def] >= 1 && vals[att] >= 1) {
            rempartLigne[def] = CONSTANTES.PARADE_PARFAITE_REMPART;
            resume = 'Parade Parfaite de ' + joueurs[def].nom + ' (+2 Rempart)';
          } else {
            resume = 'Tir bloqué sans Parade Parfaite (score à 0)';
          }
        } else {
          // Garde brisée avec absorption
          degatsRecus[def] = vals[att] - vals[def];
          resume = 'Bouclier percé : ' + joueurs[def].nom + ' subit ' + degatsRecus[def] + ' dégâts nets';
        }
      } else {
        // Attaque contre Attaque (inclut Surcharge x2 ou Brise-Garde sur ligne sans Bouclier)
        degatsRecus[0] = vals[1];
        degatsRecus[1] = vals[0];
        resume = 'Échange direct : ' + joueurs[0].nom + ' (-' + degatsRecus[0] + ') / ' + joueurs[1].nom + ' (-' + degatsRecus[1] + ')';
      }

      degatsFlechesNets[0] += degatsRecus[0];
      degatsFlechesNets[1] += degatsRecus[1];
      rempartCombatGagne[0] += rempartLigne[0];
      rempartCombatGagne[1] += rempartLigne[1];

      detailsLignes.push({
        ligne: l + 1,
        fleches: [fleches[0][l], fleches[1][l]],
        roles: roles,
        valeursEffectives: vals,
        degatsRecus: degatsRecus,
        rempartGagne: rempartLigne,
        resume: resume
      });
    }

    // --- ÉTAPE 3 : Encaissement par Priorité d'Armure & Crédit du nouveau Rempart ---
    const absorptions = [null, null];
    const pvPerdusFleches = [0, 0];

    for (let i = 0; i < 2; i++) {
      const j = joueurs[i];
      let reste = degatsFlechesNets[i];

      const absEq = Math.min(reste, j.armureEquilibrage);
      j.armureEquilibrage -= absEq;
      reste -= absEq;

      const absSouffle = Math.min(reste, j.armureSouffle);
      j.armureSouffle -= absSouffle;
      reste -= absSouffle;

      const absRempart = Math.min(reste, j.armureRempart);
      j.armureRempart -= absRempart;
      reste -= absRempart;

      pvPerdusFleches[i] = reste;
      absorptions[i] = {
        degatsNetsAvantArmure: degatsFlechesNets[i],
        absorbeEquilibrage: absEq,
        absorbeSouffle: absSouffle,
        absorbeRempart: absRempart,
        pvPerdusFleches: reste
      };

      // Crédit du nouveau Rempart gagné pendant la volée (pour les volées suivantes)
      j.armureRempart += rempartCombatGagne[i] + rempartSurplusVolee[i];
    }

    // --- ÉTAPE 4 : Effets directs simultanés du Pari All-In (ignorent toute armure) ---
    const degatsDirectsAllIn = [0, 0];
    for (let i = 0; i < 2; i++) {
      const adv = 1 - i;
      if (allInDetails[adv].actif && allInDetails[adv].reussi) {
        degatsDirectsAllIn[i] += CONSTANTES.ALL_IN_BONUS_PV;
      }
      if (allInDetails[i].actif && !allInDetails[i].reussi) {
        degatsDirectsAllIn[i] += CONSTANTES.ALL_IN_PENALITE_PV;
      }
    }

    for (let i = 0; i < 2; i++) {
      const perteTotale = pvPerdusFleches[i] + degatsDirectsAllIn[i];
      joueurs[i].pv = Math.max(0, joueurs[i].pv - perteTotale);
    }

    // Mise à jour des compteurs de Bilan de Manche (dégâts avant armure + directs All-In ; rempart combat)
    for (let i = 0; i < 2; i++) {
      joueurs[i].bilanMancheDegats += degatsFlechesNets[i] + degatsDirectsAllIn[i];
      joueurs[i].bilanMancheRempartGagne += rempartCombatGagne[i];
    }

    // Rapport complet de la volée (utilisé pour la révélation étape par étape en UI)
    const rapportVolee = {
      manche: etat.manche,
      volee: etat.volee,
      programmations: progs,
      flechesTriees: fleches,
      allIn: allInDetails,
      lignes: detailsLignes,
      absorptions: absorptions,
      degatsDirectsAllIn: degatsDirectsAllIn,
      rempartCombatGagne: rempartCombatGagne,
      rempartSurplusVolee: rempartSurplusVolee,
      evenementsMaitrise: evenementsMaitrise,
      pvApres: [joueurs[0].pv, joueurs[1].pv],
      armureActiveApres: [getArmureActive(joueurs[0]), getArmureActive(joueurs[1])],
      bilanMancheApres: [getBilanManche(joueurs[0]), getBilanManche(joueurs[1])],
      finManche: null
    };

    // --- ÉTAPE 5 : Vérification prioritaire du K.O. (0 PV) ---
    if (joueurs[0].pv === 0 && joueurs[1].pv === 0) {
      etat.statut = 'fleche_ko_match';
      rapportVolee.finManche = { evenement: 'double_ko' };
      etat.historique.push(rapportVolee);
      return rapportVolee;
    }

    if (joueurs[0].pv === 0 || joueurs[1].pv === 0) {
      const perdant = joueurs[0].pv === 0 ? 0 : 1;
      const gagnant = 1 - perdant;
      const estAutoKO = (
        allInDetails[perdant].actif &&
        !allInDetails[perdant].reussi &&
        (pvPerdusFleches[perdant] + (allInDetails[gagnant].actif && allInDetails[gagnant].reussi ? CONSTANTES.ALL_IN_BONUS_PV : 0)) < (snapshotAvant.joueurs[perdant].pv)
      );
      etat.statut = 'termine';
      etat.vainqueur = gagnant;
      etat.motifVictoire = estAutoKO ? 'auto_ko' : 'ko';
      rapportVolee.finManche = {
        evenement: estAutoKO ? 'auto_ko' : 'ko',
        vainqueur: gagnant
      };
      etat.historique.push(rapportVolee);
      return rapportVolee;
    }

    // --- ÉTAPE 6 : Avancement de volée ou Clôture de Manche (Fin Volée 3) ---
    if (etat.volee < CONSTANTES.VOLEES_PAR_MANCHE) {
      etat.volee += 1;
    } else {
      const b0 = getBilanManche(joueurs[0]);
      const b1 = getBilanManche(joueurs[1]);
      if (b0 < b1) {
        rapportVolee.finManche = cloturerManche(etat, 0, [b0, b1]);
      } else if (b1 < b0) {
        rapportVolee.finManche = cloturerManche(etat, 1, [b0, b1]);
      } else {
        // Égalité parfaite au Bilan de Manche -> Flèche de K.O. pour la manche
        etat.statut = 'fleche_ko_manche';
        rapportVolee.finManche = {
          evenement: 'egalite_manche_fleche_ko',
          bilans: [b0, b1]
        };
      }
    }

    etat.historique.push(rapportVolee);
    return rapportVolee;
  }

  /**
   * Clôture une manche gagnée par gagnantIdx, gère l'expiration des armures
   * temporaires, la conservation du Rempart et les dotations M2 / M3.
   */
  function cloturerManche(etat, gagnantIdx, bilans) {
    const perdantIdx = 1 - gagnantIdx;
    const joueurs = etat.joueurs;
    const mancheTerminee = etat.manche;

    joueurs[gagnantIdx].manchesGagnees += 1;

    // Expiration des armures temporaires (le Rempart est intégralement CONSERVÉ)
    for (let i = 0; i < 2; i++) {
      joueurs[i].armureEquilibrage = 0;
      joueurs[i].armureSouffle = 0;
    }

    // Victoire du match à 2 manches gagnantes
    if (joueurs[gagnantIdx].manchesGagnees >= CONSTANTES.MANCHES_POUR_GAGNER) {
      etat.statut = 'termine';
      etat.vainqueur = gagnantIdx;
      etat.motifVictoire = 'manches';
      return {
        evenement: 'victoire_match_manches',
        mancheTerminee: mancheTerminee,
        gagnantManche: gagnantIdx,
        vainqueurMatch: gagnantIdx,
        bilans: bilans
      };
    }

    // Passage à la manche suivante (M2 ou M3 décisive)
    etat.manche += 1;
    etat.volee = 1;

    for (let i = 0; i < 2; i++) {
      joueurs[i].bilanMancheDegats = 0;
      joueurs[i].bilanMancheRempartGagne = 0;
      // Réarmement de la Tranche d'Équilibrage en Amical Duel Équilibré uniquement
      joueurs[i].armureEquilibrage = joueurs[i].trancheEquilibrage;
    }

    const dotations = [];

    if (etat.manche === 2) {
      // Transition M1 -> M2 : +5 Souffle de Victoire au gagnant M1 ; +1 Jeton Comeback au perdant M1 (Complet)
      joueurs[gagnantIdx].armureSouffle = CONSTANTES.SOUFFLE_VICTOIRE_M2;
      dotations.push({ joueur: gagnantIdx, type: 'souffle_victoire', valeur: CONSTANTES.SOUFFLE_VICTOIRE_M2 });

      if (etat.modeJeu === 'complet') {
        const gainComeback = attribuerJeton(joueurs[perdantIdx], 'comeback_m1', false);
        dotations.push(Object.assign({ joueur: perdantIdx }, gainComeback));
      }
    } else if (etat.manche === 3) {
      // Transition M2 -> M3 décisive (1-1) :
      // 0 Souffle de Victoire gratuit !
      // Mode Complet : +1 Comeback au perdant M2 + 1 Adrénaline aux DEUX joueurs (surplus > 2 = +3 Rempart)
      if (etat.modeJeu === 'complet') {
        const gainComeback = attribuerJeton(joueurs[perdantIdx], 'comeback_m2', false);
        dotations.push(Object.assign({ joueur: perdantIdx }, gainComeback));

        for (let i = 0; i < 2; i++) {
          const gainAdrenaline = attribuerJeton(joueurs[i], 'adrenaline_m3', false);
          dotations.push(Object.assign({ joueur: i }, gainAdrenaline));
        }
      }
    }

    return {
      evenement: 'manche_terminee',
      mancheTerminee: mancheTerminee,
      gagnantManche: gagnantIdx,
      nouvelleManche: etat.manche,
      bilans: bilans,
      dotations: dotations
    };
  }

  // --------------------------------------------------------------------------
  // 7. FLÈCHE DE K.O. (STATUT STRICT HORS COMBAT) & DROIT À L'ERREUR
  // --------------------------------------------------------------------------

  /**
   * Résout une Flèche de K.O. (égalité de manche ou Double K.O.).
   * Statut strict "hors combat" : 0 PV, 0 cran de Maîtrise, 0 Rempart.
   * @param {Object} etat
   * @param {string|number} flecheJ0
   * @param {string|number} flecheJ1
   * @param {null|0|1} [plusProcheCentre=null] En cas d'égalité de valeur
   */
  function resoudreFlecheKO(etat, flecheJ0, flecheJ1, plusProcheCentre) {
    if (etat.statut !== 'fleche_ko_manche' && etat.statut !== 'fleche_ko_match') {
      throw new Error('Aucune Flèche de K.O. n\'est en attente.');
    }

    const f0 = normaliserFleche(flecheJ0);
    const f1 = normaliserFleche(flecheJ1);

    // Double 0 (paille) -> retirage obligatoire
    if (f0.valeur === 0 && f1.valeur === 0) {
      return { retirage: true, raison: 'Double 0 (paille) : retirage obligatoire.', fleches: [f0, f1] };
    }

    let gagnant = null;
    if (f0.valeur > f1.valeur) {
      gagnant = 0;
    } else if (f1.valeur > f0.valeur) {
      gagnant = 1;
    } else if (plusProcheCentre === 0 || plusProcheCentre === 1) {
      gagnant = plusProcheCentre;
    } else {
      return {
        retirage: true,
        raison: 'Égalité parfaite (' + f0.code + ' vs ' + f1.code + ') : mesurer le plus proche du centre ou retirer.',
        fleches: [f0, f1]
      };
    }

    if (etat.statut === 'fleche_ko_match') {
      etat.statut = 'termine';
      etat.vainqueur = gagnant;
      etat.motifVictoire = 'double_ko_fleche';
      return {
        retirage: false,
        type: 'double_ko_match',
        gagnant: gagnant,
        fleches: [f0, f1]
      };
    }

    // Égalité de manche
    etat.statut = 'en_cours';
    const b0 = getBilanManche(etat.joueurs[0]);
    const b1 = getBilanManche(etat.joueurs[1]);
    const suite = cloturerManche(etat, gagnant, [b0, b1]);
    return {
      retirage: false,
      type: 'egalite_manche',
      gagnant: gagnant,
      fleches: [f0, f1],
      suite: suite
    };
  }

  /**
   * Annule la toute dernière volée enregistrée ("Corriger la volée" en club).
   * Retourne le nouvel état restauré (ou null si aucune volée à annuler).
   */
  function annulerDerniereVolee(etat) {
    if (!etat || !etat.dernierSnapshot) {
      return null;
    }
    return clonerEtat(etat.dernierSnapshot);
  }

  // Export public du moteur
  return {
    CONSTANTES: CONSTANTES,
    normaliserFleche: normaliserFleche,
    trierVolee: trierVolee,
    calculerCalibration: calculerCalibration,
    calculerSeuilAllIn: calculerSeuilAllIn,
    getArmureActive: getArmureActive,
    getBilanManche: getBilanManche,
    creerMatch: creerMatch,
    basculerMode: basculerMode,
    validerProgrammation: validerProgrammation,
    resoudreVolee: resoudreVolee,
    resoudreFlecheKO: resoudreFlecheKO,
    annulerDerniereVolee: annulerDerniereVolee
  };
}));
