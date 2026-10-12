# Moneto Prediction — mfumo wa majaribio (USDT ya majaribio)

## Mpangilio wa faili
```
backend/server.js        <- server.js yako + mistari 3 mipya (hakuna kingine kilichobadilishwa)
backend/moneto-test.js   <- injini mpya (wallet, biashara, cashout, news) — iweke kando ya server.js
public/moneto-prediction.html   <- Markets + Portfolio + Wallet (inachukua nafasi ya ile ya zamani)
public/moneto-news.html         <- News & Outlook
```
Mabadiliko ndani ya server.js (tafuta `mpx`): 1) hook juu ya `api()`, 2) `require('./moneto-test')` kabla ya `http.createServer`, 3) `mpx.start()` ndani ya `listen`.

## Kuweka kwenye monetotrade.cc
Kurasa zikiwa kwenye domain ya Moneto, weka kabla ya script: `<script>window.MONETO_API='https://SERVER-YAKO-YA-DAFTARI'</script>`
au fungua kwa `moneto-prediction.html?api=https://SERVER-YAKO`. Routes za `/api/mpx/*` pekee ndizo zenye CORS wazi; routes za Daftari hazijaguswa.

## Tabia
- Akaunti: kila kivinjari kinapata token (hazihusiani na watumiaji wa Daftari). Kufuta data ya kivinjari = akaunti mpya.
- Deposit/withdraw ni simulation (withdraw inaonyesha "Processing" sekunde 20 kisha "Completed"). Ada ya withdraw 1 USDT; ada ya cashout 1% (`MPX_FEE_BPS` env).
- Nunua Yes/No kwa bei halisi ya Polymarket (hisa = stake ÷ bei; kila hisa inalipa 1 USDT ikishinda). Kinga ya bei kubadilika 3%.
- Portfolio inajisasisha kila sekunde 6: cashout value, faida/hasara, "chance you win", grafu ya thamani tangu uingie. Cashout kamili au 25/50/75%.
- Soko likifungwa Polymarket, server inalipa/inakata/inarudisha (kila dakika 1).
- Data ya Polymarket: Gamma (soko, tafuta, mpangilio), CLOB (order book, historia ya bei), Data-API (trades), mabadiliko 24h/1w, liquidity, open interest.
- News: RSS za CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine, CryptoSlate, CryptoPotato, Bitcoinist, NewsBTC, U.Today + bei (CoinGecko) + Fear&Greed + odds za Polymarket. Tag za Bullish/Bearish/Prediction na price targets zinatambuliwa KIOTOMATIKI kutoka kichwa cha habari (si nukuu za wataalam zilizothibitishwa) — ukurasa unasema hivyo wazi.

## Muhimu
Hii ni ya majaribio tu. Kabla ya fedha halisi: wallet halisi, KYC/AML, na ruhusa za kisheria za prediction markets kwa nchi husika.
