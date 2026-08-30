const f=document.getElementById('f'),msg=document.getElementById('msg'),bn=document.getElementById('businessName'),bc=document.getElementById('businessCode');
document.querySelectorAll('input[name=role]').forEach(r=>r.onchange=()=>{
  const admin=document.querySelector('input[name=role]:checked').value==='admin';
  bn.style.display=admin?'block':'none';bn.required=admin;
  bc.style.display=admin?'none':'block';bc.required=!admin;
});
f.onsubmit=async e=>{
  e.preventDefault();
  try{
    const role=document.querySelector('input[name=role]:checked').value;
    const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName:fullName.value,businessName:bn.value,businessCode:bc.value,email:email.value,password:password.value,role})});
    const d=await r.json();
    if(!r.ok)throw Error(d.error);
    localStorage.setItem('daftari_token',d.token);
    localStorage.setItem('daftari_user',JSON.stringify(d.user));
    localStorage.setItem('daftari_business',JSON.stringify(d.business));
    if(role==='admin')alert('Usajili umefanikiwa. Business Code yako: '+d.business.code+' — hifadhi hii kumwalika muuzaji wako.');
    location.href='/dashboard.html';
  }catch(x){msg.className='msg';msg.textContent=x.message}
};
