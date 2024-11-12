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
      let deferSelf = new Defer();
      let deferChild = new Defer()
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr2 = [1, 2];
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
        scope.$rootScope.arr2.push(1);
      });
      cy.wait(50);

      cy.wrap(deferSelf.promise).then((v) => {
        expect(v, `获取arr2执行结果, 耗时:${deferSelf.duration}`).to.be.deep.eq([1, 2, 1]);
      });
      cy.wrap(deferSelf).then((v) => {
        expect(deferSelf.state, `获取arr2执行结果, 耗时:${deferSelf.duration}`).to.be.deep.eq('resolved');
      });
      // 实测通过push在末尾追加元素时，数组中不相关元素也会改变状态
      cy.wrap(deferChild).then((v) => {
        expect(deferChild.state, `获取arr2[0]执行结果, 耗时:${deferChild.duration}`).to.be.deep.eq('resolved');
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
        // console.log(expect(deferChild.state, `获取arr2执行状态, 耗时:${deferSelf.duration}`),'打印结果');
        expect(deferChild.state, `获取arr2执行状态, 耗时:${deferSelf.duration}`).to.be.eq('resolved');
      });
      cy.wrap(deferChild.promise).then((v: any) => {
        expect(v, `获取arr2[0]执行结果, 耗时:${deferSelf.duration}`).to.be.eq(11);
      });

      cy.wrap(deferSelf).then((v: any) => {
        expect(deferSelf.state, `获取arr2执行状态, 耗时:${deferSelf.duration}`).to.be.eq('pending');
      });
    });
    it('scope添加数组arr3,pop移除最后一个元素,数组自身得到响应', ()=>{
      let defer = new Defer();

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr3 = [1, 2, 3];
        scope.traceCall(
          'test-call-arr3',
          () => {
            return scope.$rootScope.arr3;
          },
          (v) => defer.resolve(v)
        );

        cy.wrap(scope.$rootScope).then(() => {
          scope.$rootScope.arr3.pop()
        });
        cy.wait(50);

        cy.wrap(defer.promise).then((v) => {
          expect(v, `获取arr3执行结果, 耗时:${defer.duration}`).to.be.deep.eq(v);
        });
        cy.wrap(defer).then((v: any) => {
          expect(defer.state, `获取arr3执行状态, 耗时:${defer.duration}`).to.be.eq('resolved');
        });
      });
      
    })
    it('scope添加数组arr,使用splice操作数组,数组自身得到响应', ()=>{
      let deferSelf = new Defer();
      let deferChild = new Defer();
      let deferFirstChild = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr = [1, 2, 3, 4, 5];
        scope.traceCall(
          'test-call-arr',
          () => {
            return scope.$rootScope.arr;
          },
          (v) => deferSelf.resolve(v)
        );
        scope.traceCall(
          'test-call-arr[2]',
          () => {
            return scope.$rootScope.arr[2];
          },
          (v) => deferChild.resolve(v)
        );
        scope.traceCall(
          'test-call-arr[first]',
          () => {
            return scope.$rootScope.arr[0];
          },
          (v) => deferFirstChild.resolve(v)
        );
      });

      // 使用 splice 添加一个元素
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr.splice(2, 0, 'new item')
      });
      // 使用 splice 替换一个元素
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr.splice(2, 1, 'replaced item');
        // scope.$rootScope.arr[2] = 'replaced item';
      });
      // 使用 splice 删除元素
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr.splice(3, 2);;
      });

      cy.wait(50);

      // 在使用splice删除元素时，检测数组下标为0的元素是否发生状态改变，实测为状态改变
      cy.wrap(deferFirstChild).then((v: any) => {
        expect(deferFirstChild.state, `获取arr[0]执行状态, 耗时:${deferFirstChild.duration}`).to.be.eq('resolved');
      });
      cy.wait(50);
      cy.wrap(deferSelf.promise).then((v) => {
        expect(v, `获取arr执行结果, 耗时:${deferSelf.duration}`).to.be.deep.eq(v);
      });
      cy.wrap(deferSelf).then((v: any) => {
        expect(deferSelf.state, `获取arr执行状态, 耗时:${deferSelf.duration}`).to.be.eq('resolved');
      });

      
      cy.wrap(deferChild.promise).then((v: any) => {
        expect(v, `获取arr[2]执行结果, 耗时:${deferChild.duration}`).to.be.eq('replaced item');
      });

      // 在使用splice替换元素时，数组的状态会发生变化，但是直接赋值不会改变数组执行状态
      cy.wrap(deferSelf).then((v: any) => {
        expect(deferSelf.state, `获取arr执行状态, 耗时:${deferSelf.duration}`).to.be.eq('resolved');
      });

    })
    it('scope添加数组arr1,对数组使用 reverse 操作数组，数组自身得到响应', ()=> {
      let defer = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        // scope.$rootScope.arr1 = [];
        scope.$rootScope.arr1 = [1];
        scope.traceCall(
          'test-call-arr1',
          () => {
            return scope.$rootScope.arr1;
          },
          (v) => defer.resolve(v)
        );
      });

      // 对空数组使用reverse方法看看数组是否会发生状态变更
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr1.reverse()
      });

      cy.wait(50);

      cy.wrap(defer.promise).then((v) => {
        expect(v, `获取arr1执行结果, 耗时:${defer.duration}`).eq(v);
      })
      cy.wrap(defer).then((v) => {
        expect(defer.state, `获取arr1执行状态, 耗时:${defer.duration}`).to.be.deep.eq('resolved');
      });

      // 对只有一个元素的数组使用reverse方法看看数组是否会发生状态变更，先添加一个元素
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.arr1.reverse()
      });

      cy.wait(50); 

      cy.wrap(defer).then((v) => {
        expect(defer.state, `获取arr1执行状态, 耗时:${defer.duration}`).to.be.deep.eq('resolved');
      });

    })
  });
});
