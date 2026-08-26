const STORY_CHAPTERS = Object.freeze([
  {
    id:'day_zero',mapId:'city',title:'CAPÍTULO I — DIA ZERO',shortTitle:'Dia Zero',
    loadingTitle:'CIDADE ABANDONADA',loadingQuote:'"Quando as sirenes tocaram, ninguém sabia do que estava fugindo."',
    intro:['02:46 · DISTRITO CENTRAL','As primeiras chamadas falavam em ataques isolados.','Em menos de uma hora, as ruas já não pertenciam aos vivos.'],
    outro:['O rádio da delegacia ainda transmite uma frequência médica.','A origem parece estar ligada ao Hospital Santa Helena.'],
    requiredRound:3,
    objectives:[
      {id:'city_power',label:'Ligue o gerador do posto',interactionId:'outpost_generator'},
      {id:'city_radio',label:'Recupere os registros da delegacia',interactionId:'police_crate',requires:['city_power']},
      {id:'city_card',label:'Encontre o cartão de acesso',interactionId:'city_keycard',requires:['city_radio']},
      {id:'city_signal',label:'Ouça a frequência de emergência',interactionId:'city_radio',requires:['city_card']},
      {id:'city_survive',label:'Sobreviva até o fim do round 3',round:3},
    ],intelId:'city_intel',
  },
  {
    id:'patient_zero',mapId:'hospital',title:'CAPÍTULO II — PACIENTE ZERO',shortTitle:'Paciente Zero',
    loadingTitle:'HOSPITAL SANTA HELENA',loadingQuote:'"Quando as portas fecharam, ninguém mais saiu."',
    intro:['HOSPITAL SANTA HELENA · 04:18','Os corredores foram selados por dentro.','Alguma coisa começou aqui antes da cidade cair.'],
    outro:['A ficha do paciente não tem nome. Só um código: EDEN-07.','Um comboio transportou amostras para uma instalação na floresta.'],
    requiredRound:4,
    objectives:[
      {id:'hospital_power',label:'Restaure a energia de emergência',interactionId:'hospital_generator'},
      {id:'hospital_morgue',label:'Vasculhe a morgue',interactionId:'morgue_crate',requires:['hospital_power']},
      {id:'hospital_card',label:'Recupere o cartão EDEN-07',interactionId:'hospital_keycard',requires:['hospital_morgue']},
      {id:'hospital_survive',label:'Sobreviva até o fim do round 4',round:4},
    ],intelId:'hospital_intel',
  },
  {
    id:'eden',mapId:'forest',title:'CAPÍTULO III — PROJETO ÉDEN',shortTitle:'Projeto Éden',
    loadingTitle:'FLORESTA SOMBRIA',loadingQuote:'"A instalação não aparece em nenhum mapa oficial."',
    intro:['SETOR FLORESTAL · 23:07','Os militares chamavam o lugar de estação ecológica.','As antenas enterradas contam outra história.'],
    outro:['O Projeto Éden não buscava uma cura.','Buscava criar algo que sobrevivesse a qualquer guerra.'],
    requiredRound:4,
    objectives:[
      {id:'forest_power',label:'Ligue o gerador do posto florestal',interactionId:'ranger_generator'},
      {id:'forest_signal',label:'Restaure a antena Éden',interactionId:'forest_antenna',requires:['forest_power']},
      {id:'forest_file',label:'Encontre o arquivo EDEN-07',interactionId:'forest_intel',requires:['forest_signal']},
      {id:'forest_bunker',label:'Acesse o terminal do bunker',interactionId:'forest_bunker_terminal',requires:['forest_file']},
      {id:'forest_survive',label:'Sobreviva até o fim do round 4',round:4},
    ],intelId:'forest_intel',
  },
  {
    id:'containment',mapId:'military',title:'CAPÍTULO IV — ÚLTIMA CONTENÇÃO',shortTitle:'Última Contenção',
    loadingTitle:'ZONA MILITAR ÔMEGA',loadingQuote:'"A ordem era conter. Depois, apagar tudo."',
    intro:['BASE ÔMEGA · 01:12','O último batalhão recebeu uma ordem impossível.','A verdade foi trancada atrás do Portão Ômega.'],
    outro:['A base caiu tentando destruir as amostras.','Mas uma remessa já tinha sido enviada para o Laboratório Ômega.'],
    requiredRound:5,
    objectives:[
      {id:'military_power',label:'Ative o gerador tático',interactionId:'omega_generator'},
      {id:'military_rescue',label:'Encontre o último soldado',interactionId:'military_survivor',requires:['military_power']},
      {id:'military_gate',label:'Abra o Portão Ômega',interactionId:'omega_gate',requires:['military_rescue']},
      {id:'military_survive',label:'Derrote o boss do round 5',round:5},
    ],intelId:'military_intel',
  },
  {
    id:'truth',mapId:'industrial',title:'CAPÍTULO V — A VERDADE',shortTitle:'A Verdade',
    loadingTitle:'LABORATÓRIO ÔMEGA',loadingQuote:'"O surto não foi um acidente. Foi um teste que saiu do controle."',
    intro:['LABORATÓRIO ÔMEGA · SUBNÍVEL 03','As portas ainda têm energia.','No centro do complexo está o arquivo que todos morreram tentando esconder.'],
    outro:['ARQUIVO ÉDEN RECUPERADO','A infecção foi criada para reescrever tecido morto.','VOCÊ SOBREVIVEU À VERDADE.'],
    requiredRound:5,
    objectives:[
      {id:'lab_power',label:'Restaure a energia do laboratório',interactionId:'factory_generator'},
      {id:'lab_terminal',label:'Baixe o Arquivo Éden',interactionId:'lab_terminal',requires:['lab_power']},
      {id:'lab_survive',label:'Elimine o protótipo do round 5',round:5},
    ],intelId:'lab_intel',final:true,
  },
]);

class StorySystem{
  constructor(){
    this.chapterIndex=0;this.completed=new Set();this.intel=new Set();this.state='active';this.transitionAt=0;this.finished=false;
  }
  chapter(){return STORY_CHAPTERS[this.chapterIndex]||STORY_CHAPTERS[STORY_CHAPTERS.length-1];}
  resetChapter(){this.completed.clear();this.state='active';this.transitionAt=0;}
  canInteract(interactionId){
    const ch=this.chapter(),objective=ch.objectives.find(o=>o.interactionId===interactionId);
    if(!objective)return{allowed:true};
    const missing=(objective.requires||[]).find(id=>!this.completed.has(id));
    if(!missing)return{allowed:true,objective};
    const prior=ch.objectives.find(o=>o.id===missing);
    return{allowed:false,error:'story_locked',missingId:missing,missingLabel:prior?.label||'Conclua o objetivo anterior'};
  }
  onInteraction(id){
    const ch=this.chapter();let changed=false;
    for(const o of ch.objectives)if(o.interactionId===id&&!this.completed.has(o.id)){this.completed.add(o.id);changed=true;}
    if(ch.intelId===id&&!this.intel.has(id)){this.intel.add(id);changed=true;}
    return changed;
  }
  onRoundComplete(round){const ch=this.chapter();let changed=false;for(const o of ch.objectives)if(o.round&&round>=o.round&&!this.completed.has(o.id)){this.completed.add(o.id);changed=true;}return changed;}
  isChapterComplete(){const ch=this.chapter();return ch.objectives.every(o=>this.completed.has(o.id));}
  beginTransition(delayMs=6500){if(this.state!=='active')return false;this.state='transition';this.transitionAt=Date.now()+delayMs;return true;}
  readyToAdvance(){return this.state==='transition'&&Date.now()>=this.transitionAt;}
  advance(){
    const old=this.chapter();
    if(old.final){this.finished=true;this.state='complete';return{finished:true,chapter:old};}
    this.chapterIndex=Math.min(STORY_CHAPTERS.length-1,this.chapterIndex+1);this.resetChapter();return{finished:false,chapter:this.chapter()};
  }
  snapshot(){
    const ch=this.chapter();
    return{mode:'story',state:this.state,finished:this.finished,chapterIndex:this.chapterIndex,totalChapters:STORY_CHAPTERS.length,chapter:{...ch},completed:[...this.completed],intelFound:[...this.intel],intelCount:this.intel.size,intelTotal:STORY_CHAPTERS.length,objectives:ch.objectives.map(o=>({...o,done:this.completed.has(o.id)})),transitionAt:this.transitionAt};
  }
}
StorySystem.CHAPTERS=STORY_CHAPTERS;
module.exports=StorySystem;
