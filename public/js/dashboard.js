  /* =========================
     DEBT PAYMENT
  ========================= */

  async function payDebt(id, amount) {
    try {
      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new Error(
          'Weka kiasi sahihi.'
        );
      }

      await api(
        `/api/debts/${id}/payments`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount
          })
        }
      );

      toast(
        'Malipo ya deni yamehifadhiwa.'
      );

      await loadDebts();

    } catch (error) {
      console.error(error);

      toast(
        error.message ||
        'Imeshindikana kuhifadhi malipo.'
      );
    }
  }


  /* =========================
     LOGOUT
  ========================= */

  function setupLogout() {
    const button = $('logout');

    if (!button) return;

    button.addEventListener(
      'click',
      async () => {

        try {
          await api(
            '/api/logout',
            {
              method: 'POST'
            }
          );
        } catch (error) {
          console.warn(
            'Logout API failed:',
            error
          );
        }

        localStorage.removeItem(
          'dp_token'
        );

        localStorage.removeItem(
          'daftari_token'
        );

        localStorage.removeItem(
          'dp_user'
        );

        localStorage.removeItem(
          'daftari_user'
        );

        window.location.href =
          '/login.html';
      }
    );
  }


  /* =========================
     SUBSCRIPTION
  ========================= */

  let subscriptionPlans = [];
  let currentSubscription = null;


  async function loadSubscriptionPlans() {

    const select =
      $('subPlanSelect');

    if (!select) return;

    try {

      const data =
        await api(
          '/api/subscription/plans'
        );

      subscriptionPlans =
        Array.isArray(data?.plans)
          ? data.plans
          : [];

      select.innerHTML =
        '<option value="">Chagua subscription package</option>';

      if (!subscriptionPlans.length) {

        select.innerHTML =
          '<option value="">Hakuna package inayopatikana</option>';

        return;
      }

      subscriptionPlans.forEach(
        (plan) => {

          const option =
            document.createElement(
              'option'
            );

          option.value =
            plan.id ||
            plan.code;

          const price =
            Number(
              plan.current_price_tzs ??
              plan.price ??
              0
            );

          const days =
            Number(
              plan.days ??
              plan.duration_days ??
              30
            );

          option.textContent =
            `${plan.name} — TSh ${price.toLocaleString()} / ${days} days`;

          select.appendChild(
            option
          );
        }
      );

    } catch (error) {

      console.error(
        'Subscription plans error:',
        error
      );

      select.innerHTML =
        '<option value="">Imeshindikana kupakia packages</option>';

      toast(
        'Subscription packages hazijaweza kupakiwa.'
      );
    }
  }


  async function loadCurrentSubscription() {

    try {

      const data =
        await api(
          '/api/subscription/current'
        );

      if (!data) return;

      currentSubscription =
        data;

      const status =
        $('subStatus');

      const expiry =
        $('subExpiry');

      const card =
        $('subCurrentCard');


      if (
        data.active &&
        data.subscription
      ) {

        if (status) {
          status.textContent =
            'ACTIVE';
        }

        if (expiry) {

          expiry.textContent =
            data.subscription.expires_at
              ? new Date(
                  data.subscription.expires_at
                ).toLocaleDateString()
              : '—';
        }

        if (card) {
          card.style.display =
            '';
        }

      } else {

        if (status) {
          status.textContent =
            'EXPIRED';
        }

        if (expiry) {
          expiry.textContent =
            '—';
        }
      }

    } catch (error) {

      console.error(
        'Current subscription error:',
        error
      );
    }
  }


  async function loadSubscriptionPayments() {

    const table =
      $('subPayments');

    if (!table) return;

    try {

      const data =
        await api(
          '/api/subscription/payments'
        );

      const payments =
        Array.isArray(data?.payments)
          ? data.payments
          : [];


      if (!payments.length) {

        table.innerHTML = `
          <tr>
            <td
              colspan="6"
              class="empty">
              Hakuna historia ya malipo.
            </td>
          </tr>
        `;

        return;
      }


      table.innerHTML =
        payments
          .map(
            (payment) => {

              const plan =
                subscriptionPlans.find(
                  (p) =>
                    p.id ===
                      payment.plan_id ||
                    p.code ===
                      payment.plan_id
                );

              const name =
                plan?.name ||
                payment.plan_id ||
                'Subscription';

              const amount =
                Number(
                  payment.amount || 0
                ).toLocaleString();

              const status =
                String(
                  payment.status || ''
                ).toUpperCase();


              return `
                <tr>
                  <td>
                    ${esc(name)}
                  </td>

                  <td>
                    TSh ${amount}
                  </td>

                  <td>
                    ${esc(
                      payment.phone ||
                      '—'
                    )}
                  </td>

                  <td>
                    ${esc(status)}
                  </td>

                  <td>
                    ${
                      payment.created_at
                        ? new Date(
                            payment.created_at
                          ).toLocaleString()
                        : '—'
                    }
                  </td>

                  <td>
                    ${esc(
                      payment.order_id ||
                      '—'
                    )}
                  </td>
                </tr>
              `;
            }
          )
          .join('');

    } catch (error) {

      console.error(
        'Subscription payments error:',
        error
      );
    }
  }


  async function createSubscriptionPayment() {

    const select =
      $('subPlanSelect');

    const phoneInput =
      $('subPhone');

    const notice =
      $('subNotice');

    const button =
      $('subPayBtn');


    if (
      !select ||
      !phoneInput
    ) {
      return;
    }


    const planId =
      String(
        select.value || ''
      ).trim();

    const phone =
      String(
        phoneInput.value || ''
      ).trim();


    if (!planId) {

      toast(
        'Chagua subscription package kwanza.'
      );

      return;
    }


    if (!phone) {

      toast(
        'Weka namba ya simu.'
      );

      return;
    }


    if (button) {

      button.disabled =
        true;

      button.textContent =
        'Inatuma...';
    }


    if (notice) {

      notice.textContent =
        'Tuma ombi la malipo...';
    }


    try {

      const data =
        await api(
          '/api/subscription/create-payment',
          {
            method: 'POST',

            headers: {
              'Idempotency-Key':
                'DP-' +
                Date.now() +
                '-' +
                Math.random()
                  .toString(36)
                  .slice(2)
            },

            body:
              JSON.stringify({
                planId,
                phone
              })
          }
        );


      if (notice) {

        notice.textContent =
          data?.message ||
          'Ombi la malipo limetumwa. Subiri uthibitisho.';
      }


      toast(
        'Ombi la malipo limetumwa.'
      );


      await loadSubscriptionPayments();


      if (data?.order_id) {

        await monitorSubscriptionPayment(
          data.order_id
        );
      }


    } catch (error) {

      console.error(
        'Create subscription payment error:',
        error
      );


      if (notice) {

        notice.textContent =
          error.message ||
          'Malipo hayakuanzishwa.';
      }


      toast(
        error.message ||
        'Malipo hayakuanzishwa.'
      );


    } finally {

      if (button) {

        button.disabled =
          false;

        button.textContent =
          'Lipa sasa';
      }
    }
  }


  async function monitorSubscriptionPayment(
    orderId
  ) {

    const notice =
      $('subNotice');

    let attempts = 0;


    const timer =
      setInterval(
        async () => {

          attempts++;


          try {

            const data =
              await api(
                '/api/subscription/check-status',
                {
                  method: 'POST',

                  body:
                    JSON.stringify({
                      orderId
                    })
                }
              );


            const status =
              String(
                data?.status || ''
              ).toUpperCase();


            if (
              status ===
              'SUCCESSFUL'
            ) {

              clearInterval(
                timer
              );


              if (notice) {

                notice.textContent =
                  'Malipo yamefanikiwa. Subscription yako imewezeshwa.';
              }


              toast(
                'Subscription imewezeshwa.'
              );


              await loadCurrentSubscription();
              await loadSubscriptionPayments();

              return;
            }


            if (
              status === 'FAILED' ||
              status === 'CANCELLED'
            ) {

              clearInterval(
                timer
              );


              if (notice) {

                notice.textContent =
                  'Malipo hayakufanikiwa.';
              }


              toast(
                'Malipo hayakufanikiwa.'
              );


              await loadSubscriptionPayments();

              return;
            }


            if (notice) {

              notice.textContent =
                'Tunathibitisha malipo...';
            }


          } catch (error) {

            console.error(
              'Payment status error:',
              error
            );
          }


          if (
            attempts >= 20
          ) {

            clearInterval(
              timer
            );


            if (notice) {

              notice.textContent =
                'Bado tunasubiri uthibitisho wa malipo. Unaweza kuangalia tena baadaye.';
            }
          }

        },
        5000
      );
  }


  function setupSubscription() {

    const button =
      $('subPayBtn');


    if (button) {

      button.addEventListener(
        'click',
        createSubscriptionPayment
      );
    }


    loadSubscriptionPlans();

    loadCurrentSubscription();

    loadSubscriptionPayments();
  }


  /* =========================
     INIT
  ========================= */

  async function init() {

    try {

      currentRange =
        rangeFor('day');


      /* Navigation */
      setupNavigation();


      /* Buttons + Modals */
      setupGlobalClicks();


      /* Date Filters */
      setupFilters();


      /* Product */
      setupProductForm();


      /* Expenses */
      setupExpenseForm();


      /* Void Sale */
      setupVoidForm();


      /* Logout */
      setupLogout();


      /* Subscription */
      setupSubscription();


      /* User */
      await loadMe();


      /* Dashboard */
      await refresh();


    } catch (error) {

      console.error(
        'Daftari+ dashboard init error:',
        error
      );


      toast(
        error.message ||
        'Imeshindikana kufungua dashboard.'
      );
    }
  }


  /* =========================
     START APPLICATION
  ========================= */

  init();

})();
