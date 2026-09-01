const f=document.getElementById('f'),msg=document.getElementById('msg');
const bn=document.getElementById('businessName'),bl=document.getElementById('businessLocation'),bc=document.getElementById('businessCode');
const adminFields=document.getElementById('adminFields'),salerFields=document.getElementById('salerFields');

document.querySelectorAll('input[name=role]').forEach(r=>r.onchange=()=>{
  const admin=document.querySelector('input[name=role]:checked').value==='admin';
  adminFields.style.display=admin?'block':'none';
  salerFields.style.display=admin?'none':'block';
  bn.required=admin; bl.required=admin;
  bc.required=!admin;
});

f.onsubmit=async e=>{
  e.preventDefault();
  msg.className=''; msg.textContent='';
  try{
    const role=document.querySelector('input[name=role]:checked').value;
    const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      fullName:fullName.value,
      phone:phone.value,
      businessName:bn.value,
      businessLocation:bl.value,
      businessCode:bc.value,
      email:email.value,
      password:password.value,
      role
    })});
    const d=await r.json();
    if(!r.ok)throw Error(d.error);
    localStorage.setItem('daftari_token',d.token);
    localStorage.setItem('daftari_user',JSON.stringify(d.user));
    localStorage.setItem('daftari_business',JSON.stringify(d.business));
    if(role==='admin')alert('Usajili umefanikiwa. Business Code yako: '+d.business.code+' — hifadhi hii kumwalika muuzaji wako.');
    location.href='/dashboard.html';
  }catch(x){msg.className='msg';msg.textContent=x.message}
};
