/// <reference types="cypress" />
import { WorkerScope, SymObjectObserver, SymScopeProto } from '../../../../src/worker/workerScope.ts';
import { Defer } from '../../utils.ts';

describe('WorkScope作用域', () => {
  let scope: WorkerScope
  beforeEach(() => {
    // cy.visit('/dev/index.html');
    scope = new WorkerScope('cid-test', class {
      a = 1;
    });
    localStorage.__DEV = {};
  });
  context('创建scope', () => {
    it('从类创建scope', () => {
      scope = new WorkerScope(
        'cid-test',
        class {
          a = 1;
        }
      );

      cy.log('scope 1', scope.$rootScope);
      cy.wrap(scope.$rootScope).then(() => {
        // 确认对象属性为get/set
        expect(scope.$rootScope, '检测属性转换为get/set').ownPropertyDescriptor('a').include.keys('get', 'set');
      });
    });
  });

  context('直接属性', () => {
    it('scope直接属性赋值触发回调', () => {
      let defer = new Defer();
      let ret = scope.traceCall(
        'test-call-01',
        () => {
          return scope.$rootScope.a;
        },
        (v) => defer.resolve(v)
      );

      cy.log('初始化变量: a=', ret);
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.a = 2;
      });

      cy.wrap(defer.promise).then((v) => {
        cy.log('变更后的值: v=', v);
        cy.log('$rootScope: ', scope.$rootScope);
        expect(scope.$rootScope.a, `获取变量执行结果=2, 耗时:${defer.duration}`).to.be.eq(2);
      });
    });


    it('scope监控不存在属性,当后续赋值时应能监控到变更', () => {
      let defer = new Defer();
      let ret = scope.traceCall(
        'test-call-02',
        () => {
          // debugger
          return scope.$rootScope.b;
        },
        (v) => defer.resolve(v)
      );

      cy.wrap(scope.$rootScope).then(() => {
        expect(scope.$rootScope, '监控不存在属性时,ownerPropertyDescriptor应为空').not.ownPropertyDescriptor('b');
      });

      cy.log('初始化变量: b=', ret);
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.b = 99;
      });
      cy.log('scope= ', scope.$rootScope);
      cy.wrap(defer.promise).then((v) => {
        expect(v, `获取变量执行结果=99, 耗时:${defer.duration}`).to.be.eq(99);
      });
    });

    
    it('scope监控属性,短时间内变更多次,仅执行一次变化通知', () => {
      let callbackCounter = 0;
      
      let defer = new Defer();
      let ret = scope.traceCall(
        'test-call-03',
        () => {
          return scope.$rootScope.c;
        },
        (v) => {
          defer.resolve(v)
          callbackCounter ++
        }
      );

      cy.log('初始化变量: c=', ret);
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.c = 1;
        scope.$rootScope.c = 2;
        scope.$rootScope.c = 3;
      });
      
      cy.wait(100)

      cy.wrap(defer.promise).then((v) => {
        expect(v, `获取变量执行结果=3, 耗时:${defer.duration}`).to.be.eq(3);
        expect(callbackCounter, `变量执行次数=${callbackCounter}`).to.be.eq(1);
      });

    });

    it('scope监控属性,一定时间内变更多次,执行多次变更公职', () => {
      let callbackCounter = 0;
      let ret = scope.traceCall(
        'test-call-04',
        () => {
          return scope.$rootScope.d;
        },
        (v) => {
          callbackCounter++;
        }
      );

      cy.log('初始化变量: d=', ret);
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.d = 11;
      });
      cy.wait(50)
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.d = 22;
      });
      cy.wait(50)
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.d = 33;
      });

      cy.wait(100)
      cy.wrap(null).then(() => {
        expect(callbackCounter, `变量执行次数=${callbackCounter}`).to.be.eq(3);
      });

    });
  });

  context('对象属性', () => {
    it('scope添加对象obj1,标准流程,先添加，再跟踪，再变更', () => {
      let defer = new Defer();

      cy.wrap(scope.$rootScope).then(() => {
        // debugger
        scope.$rootScope.obj1 = {};
        cy.log('增加新对象-obj1', scope.$rootScope.obj1);
        scope.traceCall(
          'test-call-obj2',
          () => {
            return scope.$rootScope.obj1;
          },
          (v) => defer.resolve(v)
        );

        // 确定对象属性为get/set
        expect(scope.$rootScope, '检测属性转换为get/set').ownPropertyDescriptor('obj1').include.keys('get', 'set');
      });

      cy.wrap(scope.$rootScope).then(() => {
        cy.log('修改obj1');
        scope.$rootScope.obj1 = { a: 1, b: 2, c: 3 };
      });

      cy.wrap(defer.promise).then(() => {
        expect(scope.$rootScope.obj1.a, `获取obj1执行结果, 耗时:${defer.duration}`).to.be.eq(1);
      });
    });

    it('scope添加对象obj2,先跟踪，再添加', () => {
      let defer = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        // debugger
        cy.log('增加新对象-obj2', scope.$rootScope.obj2);
        scope.traceCall(
          'test-call-obj2',
          () => {
            return scope.$rootScope.obj2;
          },
          (v) => defer.resolve(v)
        );

      });

      cy.wrap(scope.$rootScope).then(() => {
        cy.log('修改obj2');
        scope.$rootScope.obj2 = { a: 1, b: 2, c: 3 };
      });

      cy.wrap(defer.promise).then((v: any) => {
        expect(v.a, `获取obj2执行结果, 耗时:${defer.duration}`).to.be.eq(1);
      });
    });

    it('scope添加对象obj3,跟踪子属性，再全部替换此对象,先前的跟踪将得到响应', () => {
      let defer = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        // debugger
        scope.$rootScope.obj3 = { a: 1, b: 2, c: 3 };
        scope.traceCall(
          'test-call-obj3.a',
          () => {
            return scope.$rootScope.obj3.a;
          },
          (v) => defer.resolve(v)
        );        

        // 确定对象属性为get/set
        expect(scope.$rootScope, '检测属性转换为get/set').ownPropertyDescriptor('obj3').include.keys('get', 'set');
      });

      cy.wrap(scope.$rootScope).then(() => {
        cy.log('修改obj3');
        scope.$rootScope.obj3 = { a: 11, b: 22, c: 33 };
      });

      cy.wait(50)

      cy.wrap(defer.promise).then((v) => {
        expect(v, `获取obj3执行结果, 耗时:${defer.duration}`).to.be.eq(11);
      });
    });

    it('scope添加复杂对象obj4,跟踪子属性，再全部替换此对象,先前的跟踪将得到响应', () => {
      let defer = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        // debugger
        scope.$rootScope.obj3 = { a: 1, b: 2, c: 3, d: { d1: 11, d2: 12, d3: 13, e: { e1: 21, e2: 22, e3: 23 } } };
        scope.traceCall(
          'test-call-obj3.d.e.e1',
          () => {
            return scope.$rootScope.obj3.d.e.e1;
          },
          (v) => defer.resolve(v)
        );
      });

      cy.wrap(scope.$rootScope).then(() => {
        cy.log('修改obj3');
        scope.$rootScope.obj3 = { a: 11, b: 22, c: 33, d: { d1: 99, e: { e1: 999 } } };
      });

      cy.wrap(defer.promise).then((v) => {
        expect(v, `获取obj3执行结果, 耗时:${defer.duration}`).to.be.eq(999);
      });
    });

    it('scope添加对象obj5,跟踪子属性和obj自身,修改子属性,仅有子属性的跟踪得到响应', () => {
      let deferSelf = new Defer();
      let deferChild = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.obj5 = { a: 1, b: 2, c: 3 };
        scope.traceCall(
          'test-call-obj5',
          () => {
            return scope.$rootScope.obj5;
          },
          (v) => deferSelf.resolve(v)
        );
        scope.traceCall(
          'test-call-obj5.a',
          () => {
            return scope.$rootScope.obj5.a;
          },
          (v) => deferChild.resolve(v)
        );
      });

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.obj5.a = 11;
      });

      cy.wrap(deferChild.promise).then((v: any) => {
        expect(v, `获取obj5.a执行结果, 耗时:${deferSelf.duration}`).to.be.eq(11);
        expect(deferChild.state, 'obj5.a得到响应').to.be.eq('resolved');
      });

      cy.wait(50).then(() => {
        expect(deferSelf.state, 'obj5自身未被触发').to.be.eq('pending');
      });
    });

    it('scope添加对象obj6,跟踪子属性和obj自身,替换obj6的值,两个跟踪均被相应', () => {
      let deferSelf = new Defer();
      let deferChild = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.obj6 = { a: 1, b: 2, c: 3 };
        scope.traceCall(
          'test-call-obj6',
          () => {
            return scope.$rootScope.obj6;
          },
          (v) => deferSelf.resolve(v)
        );
        scope.traceCall(
          'test-call-obj6.a',
          () => {
            return scope.$rootScope.obj6.a;
          },
          (v) => deferChild.resolve(v)
        );
      });

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.obj6 = { a: 11, b: 22, c: 33 };
      });

      cy.wrap(deferChild.promise).then((v) => {
        expect(v, `获取obj6.a执行结果, 耗时:${deferSelf.duration}`).to.be.eq(11);
        expect(deferChild.state, 'obj6.a得到响应').to.be.eq('resolved');
      });

      cy.wrap(deferSelf.promise).then((v: any) => {
        expect(v.a, `获取obj6执行结果, 耗时:${deferSelf.duration}`).to.be.eq(11);
        expect(deferSelf.state, 'obj6自身得到响应').to.be.eq('resolved');
      });
    });

    it('scope添加对象obj7,跟踪子属性,多次变更子属性,仅执行一次变化跟踪', () => {
      let defer = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.obj7 = { a: 1, b: 2, c: 3 };
        scope.traceCall(
          'test-call-obj7.a',
          () => {
            return scope.$rootScope.obj7.a;
          },
          (v) => defer.resolve(v)
        );
      });

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.obj7.a = 11;
        scope.$rootScope.obj7.a = 12;
        scope.$rootScope.obj7.a = 13;
      });

      cy.wrap(defer.promise).then((v) => {
        expect(v, `获取obj7.a执行结果, 耗时:${defer.duration}`).to.be.eq(13);
      });
    });

    it('scope添加对象obj8,删除子属性,子属性和自身同时得到响应', () => {
      let deferSelf = new Defer();
      let deferChild = new Defer();
      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.obj8 = { a: 1, b: 2, c: 3 };
        scope.traceCall(
          'test-call-obj8',
          () => {
            return scope.$rootScope.obj8;
          },
          (v) => deferSelf.resolve(v)
        );
        scope.traceCall(
          'test-call-obj8.a',
          () => {
            return scope.$rootScope.obj8.a;
          },
          (v) => deferChild.resolve(v)
        );
      });

      cy.wrap(scope.$rootScope).then(() => {
        scope.$rootScope.obj8.a = undefined;
        delete scope.$rootScope.obj8.a;
      });

      cy.wrap(deferChild.promise).then((v) => {
        expect(v, `获取obj8.a执行结果, 耗时:${deferSelf.duration}`).to.be.undefined;
      });

      cy.wrap(deferSelf.promise).then((v: any) => {
        cy.log('obj8:', v);
        expect(v.a, `获取obj8执行结果, 耗时:${deferSelf.duration}`).to.be.undefined;
      });
    });
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
      cy.wait(50)

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

      cy.wait(50)

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
  });
});
