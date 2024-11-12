/// <reference types="cypress" />

import { WorkerScope,SymObjectObserver ,SymScopeProto} from '../../../src/worker/workerScope.ts';

function testInitScope(scope: any) {
  cy.log('scope 1', scope.$rootScope);
  cy.wrap(scope.$rootScope).then(() => {
    // 确认对象属性为get/set
    expect(scope.$rootScope, '检测属性转换为get/set').ownPropertyDescriptor('a').include.keys('get', 'set');
    // setObj和mapObj为Set和Map对象
    expect(scope.$rootScope, '检测set对象类型').ownProperty('setObj').instanceOf(Set);
    expect(scope.$rootScope, '检测Object类型属性转换为get/set')
      .ownPropertyDescriptor('setObj')
      .to.include.keys('get', 'set');
      // 测试arr
    expect(scope.$rootScope.arr, '检测数组类型').to.be.a('array');
    expect(scope.$rootScope.arr, '检测数组长度').to.have.length(6);
    expect(scope.$rootScope.arr[0], '检测数组元素1').to.deep.eq([1,2,3]);
    expect(scope.$rootScope.arr[3], '检测数组元素2').to.eq('a');

    // 测试对象属性
    expect(scope.$rootScope.obj, '检测对象类型').to.be.a('object');
    expect(scope.$rootScope.obj.objA, '检测对象属性').to.eq(1);
    expect(scope.$rootScope.obj.objSum, '检测对象函数').to.be.a('function');
    // 检测对象可观测对象定义
    expect(scope.$rootScope.obj[SymObjectObserver], '检测对象可观测对象').to.be.a('object');
    // 检测原型定义
    expect(Reflect.getPrototypeOf(scope.$rootScope.obj)?.[SymScopeProto], '检测原型').to.be.true;


    // 测试函数
    expect(scope.$rootScope.sum, '检测函数类型').to.be.a('function');
    expect(scope.$rootScope.sum(), '执行函数').to.be.eq(6);
  });
  cy.log('scope 2:', scope.$rootScope);
}
function createTestScope() {
  return new WorkerScope('cid-test', {
    a: 1,
    b: 2,
    c: 3,
    obj: {
      objA: 1,
      objB: 2,
      objC: 3,
      objSum(): number {
        return this.objA + this.objB + this.objC;
      },
      objD: {
        objDA: 1,
        objDB: 2,
        objDC: 3,
        objDSum(): number {
          return this.objDA + this.objDB + this.objDC;
        },
      },
    },
    arr:[[1,2,3],[4,5,6],[7,8,9],'a','b','c'],
    mapObj: new Map(),
    setObj: new Set(),
    sum() {
      return this.a + this.b + this.c;
    },
    inc() {
      return this.a++;
    },
  });
}
describe('WorkScope作用域测试', () => {
    beforeEach(()=>{
        cy.visit('/dev/index.html');
        localStorage.__DEV={}
    })
  //====================================================================================================
  context('初始化', () => {
    it('创建空的Scope', () => {
      let scope = new WorkerScope('cid-test', undefined);
    });
    it('使用对象初始化Scope', () => {
      let scope = new WorkerScope('cid-test', {
        a: 1,
        b: 2,
        c: 3,
        obj: {
          objA: 1,
          objB: 2,
          objC: 3,
          objSum(): number {
            return this.objA + this.objB + this.objC;
          },
          objD: {
            objDA: 1,
            objDB: 2,
            objDC: 3,
            objDSum(): number {
              return this.objDA + this.objDB + this.objDC;
            },
          },
        },
        arr:[[1,2,3],[4,5,6],[7,8,9],'a','b','c'],

        mapObj: new Map(),
        setObj: new Set(),
        sum() {
          return this.a + this.b + this.c;
        },
        inc() {
          return this.a++;
        },
      });
      testInitScope(scope);
    });

    it('使用类初始化Scope', () => {
      let scope = createTestScope();
      testInitScope(scope);

    });
  });

  //====================================================================================================
  context('属性变更', () => {
    let scope = createTestScope();
    it('增加属性',()=>{
        scope.$rootScope.newBoolean = true
        expect(scope.$rootScope,"确认添加到自身Own属性").ownProperty('newBoolean').to.eq(true)
        expect(scope.$rootScope.newBoolean,"类型: boolean").to.eq(true)
        scope.$rootScope.newNull = null
        expect(scope.$rootScope.newNull,"类型: null").to.eq(null)
        scope.$rootScope.newUndefined = undefined
        expect(scope.$rootScope.newUndefined,"类型: undefined").to.eq(undefined)
        scope.$rootScope.newPromise = Promise.resolve(1)
        expect(scope.$rootScope.newPromise,"类型: Promise").to.be.a('promise')

        scope.$rootScope.newNumber = 1
        expect(scope.$rootScope.newNumber,"类型: number").to.eq(1)
        scope.$rootScope.newString = "a"
        expect(scope.$rootScope.newString,"类型: string").to.eq("a")
        scope.$rootScope.newArray = [1,2,3]
        expect(scope.$rootScope.newArray,"类型: array").to.deep.eq([1,2,3])
        scope.$rootScope.newObject = {a:1,b:2,c:3}
        expect(scope.$rootScope.newObject,"类型: object").to.deep.eq({a:1,b:2,c:3})
        scope.$rootScope.newFunction = ()=>1
        expect(scope.$rootScope.newFunction,"类型: function").to.be.a('function')
        cy.log('新 scope 1:',scope.$rootScope)

    })
    it('跟踪变更', () => {
        // 跟踪所有对象属性变更
        scope.traceCall("var-1", ()=>{
            JSON.stringify(scope.$rootScope)
            return scope.$rootScope.a
        },(result)=>{
          console.log('===>>trace result:',result)
        })
        
        scope.$rootScope.a +=2;

    });


  });
});
