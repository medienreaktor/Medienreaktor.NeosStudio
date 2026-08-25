(function(){var e=`data-__neos-node-contextpath`,t=`data-__neos-property`,n=`data-__neos-editable-node-contextpath`,r=`data-__neos-studio-image-property`,i=`data-__neos-studio-properties`,a=`data-neos-compare`,o=`data-neos-compare-label`,s=`data-neos-compare-id`,c=`neos-compare-focus`,l=`neos-compare-anchored`,u=`neos-compare-inset`,d={created:`34, 197, 94`,removed:`239, 68, 68`,moved:`59, 130, 246`,changed:`59, 130, 246`,variant:`168, 85, 247`};function f(e){window.parent.postMessage(e,window.location.origin)}var p=new Map,m=new Map,h=[],g=[],_=0;function v(){let t=document.createElement(`style`);t.textContent=`
    /* A site's own smooth scrolling would make the frames lag behind each
       other by an animation. Programmatic scrolls pass their behavior
       explicitly, which wins over this. */
    html, body {
      scroll-behavior: auto !important;
    }
    /* Nothing in here is interactive - say so, and keep text selection from
       looking like the start of an edit. */
    [${e}] {
      cursor: default;
    }
    [${a}] {
      /* outline, not border: it draws outside the box, so marking an element
         never reflows the page - and the two frames stay comparable. */
      transition: outline-color 150ms ease, background-color 150ms ease;
    }
    .${l} {
      position: relative;
    }
    [${a}]::before {
      content: attr(${o});
      position: absolute;
      top: 0;
      left: 0;
      z-index: 10000;
      transform: translateY(-100%);
      padding: 1px 6px;
      border-radius: 3px 3px 0 0;
      font: 600 11px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0.01em;
      color: #fff;
      white-space: nowrap;
      pointer-events: none;
    }
    /* Nothing above the element to hang the badge in - it sits inside, with
       the corner radius flipped so it still reads as attached to the top. */
    [${a}].${u}::before {
      transform: none;
      border-radius: 0 0 3px 0;
    }
    /* The change the navigation is on: a thicker outline and a halo, so it
       stands out from the other marks already on the page. */
    [${a}].${c} {
      outline-width: 3px;
      box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.35);
    }
    /* Explicitly hidden elements read as invisible-to-visitors here as well -
       the same dimming the editing guest applies. */
    [${e}][data-__neos-studio-hidden] {
      opacity: 0.5;
    }
    ${Object.entries(d).map(([e,t])=>`
    [${a}="${e}"] {
      outline: 2px solid rgb(${t});
      outline-offset: 3px;
      background-color: rgba(${t}, 0.08);
    }
    [${a}="${e}"]::before {
      background-color: rgb(${t});
    }`).join(`
`)}
  `,document.head.appendChild(t)}function y(e,t){let n=e.getAttribute(t);if(!n)return null;try{let e=JSON.parse(n);return typeof e.aggregateId==`string`?e.aggregateId:null}catch{return null}}function b(){p.clear(),m.clear();for(let t of document.querySelectorAll(`[${e}]`)){let n=y(t,e);n!==null&&!p.has(n)&&p.set(n,t)}for(let e of document.querySelectorAll(`[${n}][${t}]`)){let r=y(e,n),i=e.getAttribute(t);r===null||i===null||x(r,i,e)}for(let t of document.querySelectorAll(`[${r}]:not([${e}])`)){let n=t.closest(`[${e}]`),i=n===null?null:y(n,e),a=t.getAttribute(r);i===null||a===null||x(i,a,t)}for(let t of document.querySelectorAll(`[${i}]`)){let n=t.closest(`[${e}]`),r=n===null?null:y(n,e);if(r!==null)for(let e of(t.getAttribute(i)??``).split(`,`).map(e=>e.trim()).filter(e=>e!==``))x(r,e,t)}}function x(e,t,n){let r=m.get(e);r||(r=new Map,m.set(e,r));let i=r.get(t);i?i.includes(n)||i.push(n):r.set(t,[n])}function S(e){let t=m.get(e.aggregateId);if(!t)return[];let n=[];for(let r of e.properties){let e=t.get(r);e&&n.push(...e)}return n}function C(e,t){let n=p.get(t)??null,r=e=>e.filter(e=>e!==n);if(e.aggregateId===t)return r(S(e));let i=p.get(e.aggregateId);return r(i?[i]:S(e))}function w(e,t){e.setAttribute(a,t.status),e.setAttribute(o,t.label),e.setAttribute(s,t.aggregateId),window.getComputedStyle(e).position===`static`&&e.classList.add(l),e.getBoundingClientRect().top+window.scrollY<24&&e.classList.add(u),h.push(e)}function T(e,t){for(let e of h)e.removeAttribute(a),e.removeAttribute(o),e.removeAttribute(s),e.classList.remove(l,c,u);h=[],g=[];for(let n of e){let e=C(n,t);for(let t of e)w(t,n);g.push({aggregateId:n.aggregateId,top:e.length===0?null:E(e)})}}function E(e){let t=window.scrollY;return Math.round(Math.min(...e.map(e=>e.getBoundingClientRect().top+t)))}function D(){let e=window.scrollY,t=[];for(let[n,r]of p){let i=r.getBoundingClientRect();i.height===0&&i.width===0||t.push({aggregateId:n,top:Math.round(i.top+e),height:Math.round(i.height)})}t.sort((e,t)=>e.top-t.top);let n=new Map;for(let e of h){let t=e.getAttribute(s);if(t===null)continue;let r=n.get(t);r?r.push(e):n.set(t,[e])}return{anchors:t,placements:g.map(e=>{let t=n.get(e.aggregateId);return{aggregateId:e.aggregateId,top:t===void 0?null:E(t)}}),scrollHeight:Math.round(document.scrollingElement?.scrollHeight??document.body.scrollHeight),viewportHeight:Math.round(window.innerHeight)}}function O(e){return[e.scrollHeight,e.viewportHeight,e.anchors.map(e=>`${e.aggregateId}@${e.top}`).join(`,`),e.placements.map(e=>`${e.aggregateId}@${e.top}`).join(`,`)].join(`:`)}var k=``,A=null;function j(){A===null&&(A=window.setTimeout(()=>{A=null;let e=D(),t=O(e);t!==k&&(k=t,f({type:`neos-studio/compare-metrics`,metrics:e}))},120))}function M(){let e=new ResizeObserver(j);e.observe(document.documentElement),e.observe(document.body),document.addEventListener(`load`,j,!0),window.addEventListener(`resize`,j),window.addEventListener(`load`,j),document.fonts?.ready.then(j).catch(()=>void 0)}function N(){for(let e of[300,900,2e3,4e3])window.setTimeout(j,e)}var P=null;function F(){P===null&&(P=window.setTimeout(()=>{P=null,!(performance.now()<_)&&f({type:`neos-studio/compare-scroll`,scrollTop:window.scrollY})},16))}function I(e,t){_=performance.now()+(t?900:150),window.scrollTo({top:e,behavior:t?`smooth`:`instant`})}function L(e){for(let t of h)t.classList.toggle(c,e!==null&&t.getAttribute(s)===e)}function R(e){if(e.origin!==window.location.origin||e.source!==window.parent)return;let t=e.data;switch(t?.type){case`neos-studio/compare-marks`:T(t.marks,t.documentAggregateId),j(),N();break;case`neos-studio/compare-scroll-to`:I(t.scrollTop,t.smooth);break;case`neos-studio/compare-focus`:L(t.aggregateId);break}}function z(){document.addEventListener(`click`,e=>{e.target?.closest(`a[href], button, [role="button"]`)&&(e.preventDefault(),e.stopPropagation())},!0),document.addEventListener(`submit`,e=>e.preventDefault(),!0)}function B(){v(),b(),z(),window.addEventListener(`message`,R),window.addEventListener(`scroll`,F,{passive:!0}),M(),N();let e=D();k=O(e),f({type:`neos-studio/compare-ready`,metrics:e})}document.readyState===`loading`?document.addEventListener(`DOMContentLoaded`,B):B()})();