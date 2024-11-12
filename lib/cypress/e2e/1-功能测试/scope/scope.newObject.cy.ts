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

  context('对象属性', () => {
    it('对象的创建和删除属性', () => {
      // 初始化一个对象
      let myObject = {
        name: '',
        age: 0
      };

      // 创建对象属性
      myObject.name = 'Alice';
      myObject.age = 30;

      // 验证对象属性
      expect(myObject.name).to.equal('Alice');
      expect(myObject.age).to.equal(30);

      // 删除对象属性
      delete myObject.age;

      // 验证属性已被删除
      expect(myObject.age).to.be.undefined;
    });
    it('对象的深拷贝和浅拷贝', () => {
      // 初始化一个对象
      let myObject = {
        name: 'Alice',
        details: {
          age: 30,
          city: 'bejing'
        }
      };

      // 浅拷贝
      let shallowCopy = { ...myObject };

      // 验证浅拷贝
      expect(shallowCopy).to.deep.equal(myObject);
      expect(shallowCopy.details).to.equal(myObject.details); // 引用相同

      // 深拷贝
      let deepCopy = JSON.parse(JSON.stringify(myObject));

      // 验证深拷贝
      expect(deepCopy).to.deep.equal(myObject);
      expect(deepCopy.details).to.not.equal(myObject.details); // 引用不同
    });
  });
});
