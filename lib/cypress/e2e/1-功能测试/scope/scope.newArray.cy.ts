/// <reference types="cypress" />
import { WorkerScope, SymObjectObserver, SymScopeProto } from '../../../../src/worker/workerScope.ts';
import { Defer } from '../../utils.ts';

describe('WorkScope作用域', () => {
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

  context('数组属性', () => {
    it('scope添加数组arr1,跟踪此属性', () => {
      let defer = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        scope.traceCall(
          'test-call-arr1',
          () => {
            return scope.$rootScope.arr1;
          },
          (v) => defer.resolve(v)
        );
      });

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr1 = [];
      });

      cy.wrap(defer.promise).then((v) => {
        expect(v, `获取arr1执行结果, 耗时:${defer.duration}`);
      });
    });

    it('scope添加数组arr2,push新元素,数组自身得到响应', () => {
      let defer = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr2 = [];
        scope.traceCall(
          'test-call-arr2',
          () => {
            return scope.$rootScope.arr2;
          },
          (v) => defer.resolve(v)
        );
      });

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr2.push(1);
      });
      cy.wait(50);

      cy.wrap(defer.promise).then((v) => {
        expect(v, `获取arr2执行结果, 耗时:${defer.duration}`).to.be.deep.eq([1]);
      });
    });

    it('scope添加数组arr2,修改元素内容,仅有元素得到响应,arr自身不会触发', () => {
      let deferSelf = new Defer();
      let deferChild = new Defer();

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr2 = [1, 2, 3];
        scope.traceCall(
          'test-call-arr2',
          () => {
            return scope.$rootScope.arr2;
          },
          (v) => deferSelf.resolve(v)
        );
        scope.traceCall(
          'test-call-arr2[0]',
          () => {
            return scope.$rootScope.arr2[0];
          },
          (v) => deferChild.resolve(v)
        );
      });

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr2[0] = 11;
      });

      cy.wait(50);

      cy.wrap(deferChild.promise).then((v) => {
        expect(v, `获取arr2[0]执行结果, 耗时:${deferSelf.duration}`).to.be.eq(11);
      });
      cy.wrap(deferChild).then((v: any) => {
        expect(deferChild.state, `获取arr2执行状态, 耗时:${deferSelf.duration}`).to.be.eq('resolved');
      });
      cy.wrap(deferChild.promise).then((v: any) => {
        expect(v, `获取arr2[0]执行结果, 耗时:${deferSelf.duration}`).to.be.eq(11);
      });

      cy.wrap(deferSelf).then((v: any) => {
        expect(deferSelf.state, `获取arr2执行状态, 耗时:${deferSelf.duration}`).to.be.eq('pending');
      });
    });
    it('scope添加数组arr3,shift新元素,数组自身得到响应', () => {
      let defer = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr3 = [2, 3, 4];
        scope.traceCall(
          'test-call-arr3',
          () => {
            return scope.$rootScope.arr3;
          },
          (v) => defer.resolve(v)
        );
      });

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr3.unshift(1);
      });
      cy.wait(50);

      cy.wrap(defer.promise).then((v) => {
        expect(v, `获取arr3执行结果, 耗时:${defer.duration}`).to.be.eq(v);
      });
    });

    it('scope数字自增,数字自身得到响应', () => {
      let defer = new Defer();
      let count = 0;

      cy.wrap(scope.$rootScope).then(() => {
        scope.traceCall(
          'test-call-arr4',
          () => {
            return count;
          },
          (v) => count++
        );

      });


      cy.wait(50);

      cy.wrap(scope.$rootScope).then((v) => {
        expect(count, `获取arr4执行结果, 耗时:${defer.duration}`).eq(0);
      });

    });
  });
});
