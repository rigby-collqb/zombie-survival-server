/** Entrada e pequenos ajustes de shell/mobile. */
(function(){
  function setAppHeight(){const h=Math.max(1,Math.round(window.visualViewport?.height||window.innerHeight));document.documentElement.style.setProperty('--app-height',`${h}px`);}
  setAppHeight();
  window.addEventListener('resize',setAppHeight,{passive:true});
  window.visualViewport?.addEventListener('resize',setAppHeight,{passive:true});
  window.addEventListener('orientationchange',()=>setTimeout(setAppHeight,120),{passive:true});
  document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
  if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js?v=60').catch(()=>{});

  window.addEventListener('DOMContentLoaded',async()=>{
    try{
      // A cutscene aparece em todo novo carregamento do site. O jogador pode
      // clicar/tocar em qualquer ponto para ir direto ao menu.
      if(window.__introPromise)await window.__introPromise;
      else if(window.IntroCutscene?.play)await window.IntroCutscene.play();
    }catch(err){console.warn('[intro] cutscene ignorada:',err);}
    window.__game=new Game();
  });
})();
