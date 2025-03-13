const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const Dotenv = require('dotenv-webpack');

// 你需要为Istanbul创建一个webpack loader
// 这里假设使用babel-plugin-istanbul
const isDevelopment = process.env.NODE_ENV !== 'production';
const envFile = !isDevelopment ? '.env.production' : '.env';

module.exports = {
  mode: isDevelopment ? 'development' : 'production',
  entry: './src/main.tsx', // 假设这是你的入口点，根据你的项目调整
  
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash].js',
    clean: true, // 相当于在每次构建前清理dist文件夹
  },
  
  module: {
    rules: [
      {
        test: /\.(js|jsx|ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              ['@babel/preset-react', { runtime: 'automatic' }], 
              '@babel/preset-typescript'
            ],
            plugins: [
              isDevelopment && require.resolve('react-refresh/babel'),
              // 添加istanbul babel插件用于代码覆盖率
              [
                'babel-plugin-istanbul',
                {
                  include: 'src/*',
                  exclude: ['node_modules', 'test/', '**/*.test.tsx', '**/*.spec.tsx'],
                  extension: ['.js', '.jsx', '.ts', '.tsx'],
                  requireEnv: false,
                  checkProd: false,
                  cypress: false,
                  forceBuildInstrument: true,
                  debug: true, // 启用调试以帮助诊断问题
                }
              ]
            ].filter(Boolean),
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },
  
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    mainFields: ['module', 'browser', 'main'],
    alias: {
      // 添加源代码目录别名，帮助解决导入问题
      '@': path.resolve(__dirname, 'src'),
    },
  },
  
  devtool: 'source-map', // 确保源映射生成，对代码覆盖率很重要
  
  plugins: [
    new Dotenv({
      path: envFile, // 指定.env文件路径
      systemvars: true, // 加载所有系统环境变量
      prefix: 'process.env.' // 为所有变量添加process.env.前缀
    }),
    new HtmlWebpackPlugin({
      template: './index.html', // 假设这是你的HTML模板位置
    }),
  
    isDevelopment && new ReactRefreshWebpackPlugin(),
    
    // 可选：添加bundle分析器
    process.env.ANALYZE && new BundleAnalyzerPlugin(),
  ].filter(Boolean),
  
  optimization: {
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          keep_classnames: true, // 对应Vite中的keepNames
          keep_fnames: true,
        },
      }),
    ],
    splitChunks: {
      chunks: 'all',
    },
  },
  
  devServer: {
    static: {
      directory: path.join(__dirname, 'public'),
    },
    hot: true,
    port: 3000,
    historyApiFallback: true,
  },
  
  target: ['web', 'es2015'], // 对应Vite的target配置
  
  // 设置Node.js polyfills
  // 由于前面已经定义了resolve，这里我们合并fallback设置
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    mainFields: ['module', 'browser', 'main'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    fallback: {
      path: require.resolve('path-browserify'),
      stream: require.resolve('stream-browserify'),
      util: require.resolve('util/'),
      buffer: require.resolve('buffer/'),
    },
  },
};