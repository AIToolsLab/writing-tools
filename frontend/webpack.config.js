/* eslint-disable no-undef */

const path = require('path');

const webpack = require('webpack');
const devCerts = require('office-addin-dev-certs');

const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const urlDev = 'https://localhost:3000';
const urlProd = 'https://app.thoughtful-ai.com';

const backendDev = 'http://0.0.0.0:8000/';
const backendProd = 'https://textfocals.azurewebsites.net/';

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
			react: ['react', 'react-dom'],
			taskpane: {
				import: ['./src/index.tsx', './src/taskpane.html'],
				dependOn: 'react'
			},
			logs: {
				import: ['./src/logs/index.tsx', './src/logs/logs.html'],
				dependOn: 'react'
			},
			popup: {
				import: [
					'./src/popup.tsx',
					'./src/popup.html'
				],
				dependOn: 'react'
			},
			editor: {
				import: ['./src/editor/index.tsx', './src/editor/editor.html'],
				dependOn: 'react'
			},
		    commands: './src/commands/commands.ts'
		},
		output: {
			clean: true,
			filename: '[name].[contenthash].js',
			chunkFilename: '[name].[contenthash].js'
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
					test: /\.(png|jpg|jpeg|ttf|woff|woff2|gif|ico)$/,
					type: 'asset/resource',
					generator: {
						filename: 'assets/[name].[contenthash][ext][query]'
					}
				},
				// CSS Modules: only for *.module.css
				{
					test: /\.module\.css$/,
					exclude: /node_modules/,
					use: [
						{
							loader: 'style-loader'
						},
						{
							loader: 'css-loader',
							options: {
								modules: true
							}
						},
						{
							loader: 'postcss-loader',
						}
					]
				},
				// Global CSS (including Tailwind): all other .css files
				{
					test: /(?<!\.module)\.css$/,
					exclude: /node_modules/,
					use: [
						{
							loader: 'style-loader'
						},
						{
							loader: 'css-loader',
							options: {
								modules: false
							}
						},
						{
							loader: 'postcss-loader',
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
									.replace(/\-dev/g, '')
									.replace(new RegExp(urlDev, 'g'), urlProd);
						}
					}
				]
			}),
			new HtmlWebpackPlugin({
				filename: 'taskpane.html',
				template: './src/taskpane.html',
				chunks: ['polyfill', 'taskpane', 'react']
			}),
			new HtmlWebpackPlugin({
				filename: 'editor.html',
				template: './src/editor/editor.html',
				chunks: ['editor', 'react']
			}),
			new HtmlWebpackPlugin({
				filename: 'popup.html',
				template: './src/popup.html',
				chunks: ['polyfill', 'popup', 'react']
			}),
			new HtmlWebpackPlugin({
				filename: 'commands.html',
				template: './src/commands/commands.html',
				chunks: ['polyfill', 'commands']
			}),
			new webpack.ProvidePlugin({
				Promise: ['es6-promise', 'Promise']
			}),
			new webpack.DefinePlugin({
				'process.env.AUTH0_DOMAIN': JSON.stringify('dev-rbroo1fvav24wamu.us.auth0.com'),
				'process.env.AUTH0_CLIENT_ID': JSON.stringify('YZhokQZRgE2YUqU5Is9LcaMiCzujoaVr')
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
			proxy: [
				{
					context: ['/api'],
					target: dev ? backendDev : backendProd,
					changeOrigin: true
				}
			],
			compress: false
		}
	};

	return config;
};
