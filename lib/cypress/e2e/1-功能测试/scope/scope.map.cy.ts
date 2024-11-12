/// <reference types="cypress" />
import { WorkerScope, SymObjectObserver, SymScopeProto } from '../../../../src/worker/workerScope.ts';
import { Defer } from '../../utils.ts';

describe('WorkScope:Map', () => {
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

  it('scope添加Map属性map1,跟踪此属性', () => {
    let defer = new Defer();
    cy.wrap(scope.$rootScope).then(() => {
      scope.traceCall(
        'test-call-map1',
        () => {
          return scope.$rootScope.map1;
        },
        (v) => defer.resolve(v)
      );
    });

    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.map1 = new Map();
    });

    cy.wrap(defer.promise).then((v) => {
      expect(v, `获取map1执行结果, 耗时:${defer.duration}`);
    });
  });

  it('scope添加Map属性map2,set新元素,Map自身得到响应', () => {
    let defer = new Defer();
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.map2 = new Map();
      scope.traceCall(
        'test-call-map2',
        () => {
          return scope.$rootScope.map2;
        },
        (v) => defer.resolve(v)
      );
    });

    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.map2.set('a', 1);
    });
    cy.wait(50);

    cy.wrap(defer.promise).then((v: any) => {
      expect(v, `获取map2执行结果, 耗时:${defer.duration}`);
      expect(v.get('a')).to.be.eq(1);
    });
  });

  it('scope添加Map属性map3,修改元素内容,仅有元素得到响应,Map自身不会触发', () => {
    let mapSelfCallCount = 0;
    let mapChildCallCount = 0;

    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.map3 = new Map();
      scope.$rootScope.map3.set('a', 1);
      scope.traceCall(
        'test-call-map3',
        () => {
          return scope.$rootScope.map3;
        },
        (v) => mapSelfCallCount++
      );
      scope.traceCall(
        'test-call-map3-child',
        () => {
          return scope.$rootScope.map3.get('a');
        },
        (v) => mapChildCallCount++
      );
    });
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.map3.set('a', 2);
      console.log("---------->>",scope.$rootScope.map3);
    });

    cy.wait(50);  

    cy.wrap(scope.$rootScope).then(() => {
      expect(mapSelfCallCount,'检测自身未被调用').to.be.eq(0);
      expect(mapChildCallCount,'检测属性回调').to.be.eq(1);
    });

    // 
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.map3.set('b', 22);
    });
    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      console.log("----------> Check map3",scope.$rootScope.map3);
      expect(mapSelfCallCount,'检测自身回调').to.be.eq(1);
      expect(mapChildCallCount,'检测属性a回调,由于对象自身回调触发').to.be.eq(2);
    });

    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.map3.set('a', 3);
    });
    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      expect(mapSelfCallCount,'检测自身回调,已有成员,不会触发自身变化').to.be.eq(1);
      expect(mapChildCallCount,'检测属性a回调触发').to.be.eq(3);
    });

  });


  it('scope添加Map属性map4,删除元素,Map自身得到响应,所有子元素也将触发', () => {
    let selfCallCount = 0;
    let prop_a_CallCount = 0;    
    let prop_b_CallCount = 0;
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.map4 = new Map();
      scope.$rootScope.map4.set('a', 1);
      scope.$rootScope.map4.set('b', 2);
      scope.traceCall(
        'test-call-map4',
        () => {
          return scope.$rootScope.map4;
        },
        (v) => selfCallCount++
      );
      scope.traceCall(
        'test-call-map4-a',
        () => {
          return scope.$rootScope.map4.get('a');
        },
        (v) => prop_a_CallCount++
      );
      scope.traceCall(
        'test-call-map4-b',
        () => {
          return scope.$rootScope.map4.get('b');
        },
        (v) => prop_b_CallCount++
      );
    });
    cy.wrap(scope.$rootScope).then(() => {
      scope.$rootScope.map4.delete('a');
    });
    cy.wait(50);
    cy.wrap(scope.$rootScope).then(() => {
      expect(selfCallCount,'检测自身回调').to.be.eq(1);
      expect(prop_a_CallCount,'检测属性a回调').to.be.eq(1);
      expect(prop_b_CallCount,'检测属性b回调').to.be.eq(1);
    });
  });
  
});
