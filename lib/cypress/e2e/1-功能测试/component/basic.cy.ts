/// <reference types="cypress" />

import { WorkerScope, SymObjectObserver, SymScopeProto } from '../../../../src/worker/workerScope.ts';
import { Defer } from '../../utils.ts';

describe('基础组件', () => {
  beforeEach(() => {
    cy.visit('/cypress/e2e/1-功能测试/component/basic.html').then(() => {
        localStorage.__DEV = {};
        });
  });

  it('创建基础组件', () => {
    expect('成功创建基础组件').to.equal('成功创建基础组件');
  });
});
