import type { Compte } from './compte/moteur';

export interface Message {
  id: string;
  de: string;
  date: number;
  titre: string;
  texte: string;
}

export const MESSAGES: Message[] = [
  {
    id: 'bienvenue',
    de: 'Parnassa Trader',
    date: Date.UTC(2026, 9, 7, 8, 0),
    titre: 'Bienvenue sur Parnassa Trader',
    texte:
      "Bienvenue ! Votre compte de démonstration est ouvert sur le serveur Parnassa-Demo avec 10 000 USD et un levier de 1:100.\n\n" +
      "• Ouvrez une position avec F9 (Nouvel ordre) ou directement depuis le panneau de trading en un clic du graphique.\n" +
      "• Faites glisser les lignes SL, TP et des ordres en attente sur le graphique pour les modifier.\n" +
      "• Clic droit sur le graphique → Trading pour placer un ordre limite ou stop au prix pointé.\n" +
      "• Les cotations sont réelles (forex, or, indices, actions, crypto) ; l'argent ne l'est pas.\n\n" +
      'Bon trading !',
  },
  {
    id: 'regles',
    de: 'Parnassa Trader',
    date: Date.UTC(2026, 9, 7, 8, 1),
    titre: 'Conditions de trading du compte démo',
    texte:
      "Mode de compte : couverture (hedging). Achat à l'Ask, vente au Bid.\n" +
      'Appel de marge : 100 %. Stop-out : 50 % (la position la plus perdante est fermée en premier).\n' +
      'Forex : écarts fixes de 1,2 à 3 pips selon la paire. Crypto : carnet d\'ordres réel de Binance.\n' +
      'Séances : forex, métaux, indices et énergie du dimanche 22:00 au vendredi 21:00 UTC ; actions selon leur bourse ; crypto 24 h/24.',
  },
];

const argent = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Boîte aux lettres : messages du terminal et relevé quotidien de chaque jour de trading (les 14 derniers jours),
 * comme les relevés journaliers qu'envoient les courtiers MT5.
 */
export function messagesCompte(c: Compte): Message[] {
  const parJour = new Map<string, Compte['transactions']>();
  const limite = Date.now() - 14 * 86400000;
  const aujourdHui = new Date().toDateString();
  for (const t of c.transactions) {
    if (t.entree !== 'out' || t.heure < limite) continue;
    const jour = new Date(t.heure);
    if (jour.toDateString() === aujourdHui) continue;
    const cle = `${jour.getFullYear()}${String(jour.getMonth() + 1).padStart(2, '0')}${String(jour.getDate()).padStart(2, '0')}`;
    parJour.set(cle, [...(parJour.get(cle) ?? []), t]);
  }
  const releves: Message[] = [...parJour.entries()].map(([cle, liste]) => {
    const d = new Date(Number(cle.slice(0, 4)), Number(cle.slice(4, 6)) - 1, Number(cle.slice(6, 8)), 23, 59);
    const res = liste.map((t) => t.profit + t.swap + t.commission);
    const net = res.reduce((a, b) => a + b, 0);
    const gagnants = res.filter((r) => r > 0).length;
    const fin = liste[liste.length - 1].solde;
    const symboles = [...new Set(liste.map((t) => t.symbole))].join(', ');
    const jourTexte = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return {
      id: `releve-${c.login}-${cle}`,
      de: c.serveur,
      date: d.getTime(),
      titre: `Relevé du ${jourTexte} : ${net >= 0 ? '+' : ''}${argent(net)} USD`,
      texte:
        `Relevé journalier du compte ${c.login} (${c.nom}), ${jourTexte}.\n\n` +
        `Trades fermés : ${liste.length} (${gagnants} gagnant${gagnants > 1 ? 's' : ''}, ${liste.length - gagnants} perdant${liste.length - gagnants > 1 ? 's' : ''})\n` +
        `Résultat net : ${net >= 0 ? '+' : ''}${argent(net)} USD\n` +
        `Meilleur trade : ${argent(Math.max(...res))} USD · pire trade : ${argent(Math.min(...res))} USD\n` +
        `Symboles : ${symboles}\n` +
        `Solde en fin de journée : ${argent(fin)} USD`,
    };
  });
  return [...releves, ...MESSAGES].sort((a, b) => b.date - a.date);
}
