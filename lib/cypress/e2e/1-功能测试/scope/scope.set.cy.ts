/// <reference types="cypress" />
import { WorkerScope, SymObjectObserver, SymScopeProto } from '../../../../src/worker/workerScope.ts';
import { Defer } from '../../utils.ts';

describe('WorkScope:Set', () => {
  let scope: WorkerScope;
  beforeEach(() => {
    // cy.visit('/dev/index.html');
    scope = new WorkerScope(
      'cid-test',
      class {
        a = 1;
        b = 2;
        c = 3;
      }
    );
    localStorage.__DEV = {};
  });
  it('scope添加Set属性set1,跟踪此属性', () => {
    let selfCallbackCount = 0;
    cy.wrap(scope.$rootScope).then(() => {
      scope.traceCall(
        'test-call-set1',
        () => {
          return scope.$rootScope.set1;
        },
        (v) => selfCallbackCount++
      );
    });

    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set1 = new Set();
    });

    cy.wait(50);

    cy.wrap(scope.$rootScope).then(() => {
      expect(selfCallbackCount).to.eq(1);
    });
  });

  it('scope添加Set属性set2,添加新元素,Set自身得到响应', () => {
    let selfCallbackCount = 0;
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set2 = new Set();
      scope.traceCall(
        'test-call-set2',
        () => {
          return scope.$rootScope.set2;
        },
        (v) => selfCallbackCount++
      );
    });

    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set2.add(1);
    });

    cy.wait(50);

    cy.wrap(scope.$rootScope).then(() => {
      expect(selfCallbackCount).to.eq(1);
    });
  });

  it('scope添加Set属性set3,add相同元素,不触发变动,添加不同元素触发变动', () => {
    let selfCallbackCount = 0;
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set3 = new Set();
      scope.traceCall(
        'test-call-set3',
        () => {
          return scope.$rootScope.set3;
        },
        (v) => selfCallbackCount++
      );
    });

    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set3.add(1);
    });

    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set3.add(1);
    })

    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      expect(selfCallbackCount).to.eq(1);
    });
    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set3.add(2);
    });
    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      expect(selfCallbackCount).to.eq(2);
    });
  });

  it('scope添加Set属性set4,delete元素,Set自身得到响应', () => {
    let selfCallbackCount = 0;
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set4 = new Set();
      scope.$rootScope.set4.add(1);
      scope.traceCall(
        'test-call-set4',
        () => {
          return scope.$rootScope.set4;
        },
        (v) => selfCallbackCount++
      );
    });

    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set4.delete(1);
    });

    cy.wait(50);

    cy.wrap(scope.$rootScope).then(() => {
      expect(selfCallbackCount).to.eq(1);
    });
  });

  it('scope添加Set属性set5,clear元素,Set自身得到响应', () => {
    let selfCallbackCount = 0;
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set5 = new Set();
      scope.$rootScope.set5.add(1);
      scope.traceCall(
        'test-call-set5',
        () => {
          return scope.$rootScope.set5;
        },
        (v) => selfCallbackCount++
      );
    });

    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set5.clear();
    });

    cy.wait(50);

    cy.wrap(scope.$rootScope).then(() => {
      expect(selfCallbackCount).to.eq(1);
    });
  });

  it('scope添加Set属性set6,添加新元素为对象,修改新增对象的属性,监控此对象属性', () => {
    let selfCallbackCount = 0;
    let propACallbackCount = 0;
    scope.$rootScope.set6 = new Set();
    let newObj = { a: 1 };
  cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set6.add(newObj);
      scope.traceCall(
        'test-call-set6',
        () => {
          return scope.$rootScope.set6;
        },
        (v) => selfCallbackCount++
      );
      scope.traceCall(
        'test-call-set6-a',
        () => {
          return newObj.a;
        },
        (v) => propACallbackCount++
      );
    });

    cy.wrap(scope.$rootScope).then(() => {
      newObj.a = 2;
    });

    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      expect(selfCallbackCount).to.eq(0);
      expect(propACallbackCount).to.eq(1);
    });

    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.set6.add({ a: 1 });
    });

    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      expect(selfCallbackCount).to.eq(1);
      expect(propACallbackCount).to.eq(1);
    });
  });
});
