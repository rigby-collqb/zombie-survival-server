const PROFILE_STORAGE_KEY='zso_profile_v20';
const SETTINGS_STORAGE_KEY='zso_settings_v20';

const CHARACTER_SKINS_CLIENT=Object.freeze({
  survivor_blue:{id:'survivor_blue',name:'Sobrevivente Azul',body:'#3fa9ff'},
  survivor_red:{id:'survivor_red',name:'Sobrevivente Vermelho',body:'#dc5555'},
  hazmat:{id:'hazmat',name:'Hazmat',body:'#e4d44d'},
  military:{id:'military',name:'Militar',body:'#6f8d5a'},
  shadow:{id:'shadow',name:'Shadow',body:'#7d62a8'},
});
const WEAPON_SKINS_CLIENT=Object.freeze({
  default:{id:'default',name:'Padrão',color:null},
  rusty:{id:'rusty',name:'Ferrugem',color:'#8c5f42'},
  gold:{id:'gold',name:'Dourada',color:'#d9b53f'},
  neon:{id:'neon',name:'Neon',color:'#51e6cf'},
});
function clientCharacterSkin(id){return CHARACTER_SKINS_CLIENT[id]||CHARACTER_SKINS_CLIENT.survivor_blue;}
function clientWeaponSkin(id){return WEAPON_SKINS_CLIENT[id]||WEAPON_SKINS_CLIENT.default;}

class ProfileManager{
  constructor(){
    this.token='';this.recovery=null;this.account=null;
    this._load();
  }
  _load(){try{const raw=JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY)||'null');if(raw){this.token=String(raw.token||'');this.recovery=raw.recovery||null;this.account=raw.account||null;}}catch(_){}
  }
  save(){try{localStorage.setItem(PROFILE_STORAGE_KEY,JSON.stringify({token:this.token,recovery:this.recovery,account:this.account}));}catch(_){}
  }
  apply(result){if(!result?.success)return; if(result.token)this.token=result.token;if(result.recovery)this.recovery=result.recovery;if(result.account)this.account=result.account;this.save();}
  hasAccount(){return !!(this.token&&this.account?.name);}
  name(){return this.account?.name||'';}
  bootstrapPayload(name=''){return{token:this.token||'',name:String(name||'').trim(),recovery:this.recovery||null};}
}

window.__zsoProfile=window.__zsoProfile||new ProfileManager();
