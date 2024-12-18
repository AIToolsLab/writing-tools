/* eslint-disable no-undef */

const path = require('path');

const webpack = require('webpack');
const devCerts = require('office-addin-dev-certs');

const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const urlDev = 'https://localhost:3000';
const urlProd = 'https://thoughtful-ai.com';

async function getHttpsOptions() {
	const httpsOptions = await devCerts.getHttpsServerOptions();
	return {
		ca: httpsOptions.ca,
		key: httpsOptions.key,
		cert: httpsOptions.cert
	};
}

module.exports = async (env, options) => {
	const dev = options.mode === 'development';
	const config = {
		devtool: 'source-map',
		entry: {
			polyfill: ['core-js/stable', 'regenerator-runtime/runtime'],
			vendor: ['react', 'react-dom', 'core-js'],
			taskpane: ['./src/index.tsx', './src/taskpane.html'],
			logs: ['./src/logs/index.tsx', './src/logs/logs.html'],
			popup: [
				'./src/popup.tsx',
				'./src/popup.html'
			],
			editor: ['./src/editor/index.tsx', './src/editor/editor.html'],
      commands: './src/commands/commands.ts'
		},
		output: {
			clean: true
		},
		resolve: {
			alias: {
				'@': path.resolve(__dirname, 'src')
			},
			extensions: ['.ts', '.tsx', '.html', '.js', '.css']
		},
		module: {
			rules: [
				{
					test: /\.ts$/,
					exclude: /node_modules/,
					use: {
						loader: 'babel-loader',
						options: {
							presets: ['@babel/preset-typescript']
						}
					}
				},
				{
					test: /\.tsx?$/,
					exclude: /node_modules/,
					use: ['ts-loader']
				},
				{
					test: /\.html$/,
					exclude: /node_modules/,
					use: 'html-loader'
				},
				{
					test: /\.(png|jpg|jpeg|gif|ico)$/,
					type: 'asset/resource',
					generator: {
						filename: 'assets/[name][ext][query]'
					}
				},
				{
					test: /\.css$/,
					use: [
						{
							loader: 'style-loader'
						},
						{
							loader: 'css-loader'
						}
					]
				}
			]
		},
		plugins: [
			new CopyWebpackPlugin({
				patterns: [
					{
						from: 'assets/*',
						to: 'assets/[name][ext][query]'
					},
					{
						from: 'src/static/*',
						to: '[name][ext]'
					},
					{
						from: 'manifest.xml',
						to: '[name]' + '[ext]',
						transform(content) {
							if (dev) return content;
							else
								return content
									.toString()
									.replace(new RegExp(urlDev, 'g'), urlProd);
						}
					}
				]
			}),
			new HtmlWebpackPlugin({
				filename: 'taskpane.html',
				template: './src/taskpane.html',
				chunks: ['taskpane', 'vendor', 'polyfills']
			}),
			new HtmlWebpackPlugin({
				filename: 'editor.html',
				template: './src/editor/editor.html',
				chunks: ['editor', 'vendor']
			}),
			new HtmlWebpackPlugin({
				filename: 'popup.html',
				template: './src/popup.html',
				chunks: ['popup', 'vendor', 'polyfills']
			}),
			new HtmlWebpackPlugin({
				filename: 'commands.html',
				template: './src/commands/commands.html',
				chunks: ['commands']
			}),
			new webpack.ProvidePlugin({
				Promise: ['es6-promise', 'Promise']
			})
		],
		devServer: {
			hot: true,
			headers: {
				'Access-Control-Allow-Origin': '*'
			},
			server: {
				type: 'https',
				options:
					env.WEBPACK_BUILD || options.https !== undefined
						? options.https
						: await getHttpsOptions()
			},
			port: process.env.npm_package_config_dev_server_port || 3000,
			proxy: {
				'/api': {
					target: 'https://textfocals.azurewebsites.net/',
					changeOrigin: true
				}
			},
			compress: false
		}
	};

	return config;
};
