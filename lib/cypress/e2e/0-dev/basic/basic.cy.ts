/// <reference types="cypress" />


describe('基础组件', () => {
  beforeEach(() => {
    cy.visit('/cypress/e2e/0-dev/basic/index.html',{
      onBeforeLoad: (win) => {
        win.localStorage.__DEV = {};
      }
    });
    // 等待所有组件加载完毕
    cy.window().then((win) => {
      return new Promise((resolve) => {
        win.addEventListener('WooReady', () => {
          resolve(null);
        });
      });
    });

  });

  it.only('创建<self.app->组件', () => {
    cy.window().then((win) => {
      expect(win.customElements.get('self.app-'), '组件注册成功').to.not.be.undefined;
    })

  });
  it('创建基础组件2', () => {
    expect('成功创建基础组件').to.equal('成功创建基础组件');
  });
});
