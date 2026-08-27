const ACHIEVEMENTS = Object.freeze({
  first_blood:{id:'first_blood',name:'Primeiro Sangue',description:'Elimine seu primeiro zumbi.',coins:10},
  headhunter_100:{id:'headhunter_100',name:'Caçador de Cabeças',description:'Consiga 100 headshots.',coins:60,weaponSkin:'crimson'},
  round_20:{id:'round_20',name:'Ainda de Pé',description:'Sobreviva até o round 20.',coins:100},
  boss_hunter:{id:'boss_hunter',name:'Caçador de Monstros',description:'Elimine 10 bosses.',coins:120},
  medic_10:{id:'medic_10',name:'Anjo da Guarda',description:'Reviva 10 aliados.',coins:80},
  perk_collector:{id:'perk_collector',name:'Química Perfeita',description:'Tenha 4 perks ao mesmo tempo.',coins:80},
  pack_master:{id:'pack_master',name:'Além do Limite',description:'Evolua uma arma até MK-III.',coins:90},
  mystery_legendary:{id:'mystery_legendary',name:'Sorte Maldita',description:'Tire uma arma lendária na Caixa do Acaso.',coins:70},
  story_complete:{id:'story_complete',name:'A Verdade',description:'Conclua o Modo História.',coins:250,skin:'outbreak'},
  truth_seeker:{id:'truth_seeker',name:'O Que Eles Esconderam',description:'Encontre todos os arquivos secretos da campanha.',coins:150,weaponSkin:'biohazard'},
  nightmare_10:{id:'nightmare_10',name:'Sem Esperança',description:'Sobreviva até o round 10 no Pesadelo.',coins:140,skin:'nightmare'},
  arsenal_master:{id:'arsenal_master',name:'Arsenal Proibido',description:'Use uma arma experimental.',coins:45},
  event_survivor:{id:'event_survivor',name:'Contra o Caos',description:'Sobreviva a um evento mundial.',coins:35},
  elite_slayer:{id:'elite_slayer',name:'Sangue Superior',description:'Elimine um infectado ELITE.',coins:45,weaponSkin:'toxic'},
  mutation_survivor:{id:'mutation_survivor',name:'Adaptação Forçada',description:'Sobreviva a um round de mutação.',coins:55},
  combo_20:{id:'combo_20',name:'Sem Tirar o Dedo',description:'Faça uma sequência de 20 eliminações durante uma partida.',coins:75},
});

function evaluateFromAccount(account){
  if(!account)return[];
  const s=account.stats||{}, out=[];
  if((s.kills||0)>=1)out.push('first_blood');
  if((s.headshots||0)>=100)out.push('headhunter_100');
  if((s.highestRound||0)>=20)out.push('round_20');
  if((s.bossesKilled||0)>=10)out.push('boss_hunter');
  if((s.revives||0)>=10)out.push('medic_10');
  if((s.storyCompletions||0)>=1)out.push('story_complete');
  return out;
}

module.exports={ACHIEVEMENTS,evaluateFromAccount};
