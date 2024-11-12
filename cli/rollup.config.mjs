
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';


export default {
    input: 'src/index.ts',
    output: {
        format: 'umd',
        dir: 'dist',
    },
    plugins:[
       typescript(),
       nodeResolve()
    ]
};

