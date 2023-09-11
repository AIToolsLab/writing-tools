import Navbar from '../navbar';

export default function Layout({ children }: React.PropsWithChildren<any>) {
	return (
		<>
			<Navbar />

			{ children }
		</>
	);
}
