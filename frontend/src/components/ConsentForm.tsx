export function ConsentForm({ onConsent }: { onConsent: () => void }) {
	return (
		<div className="prose text-left h-[90vh] overflow-y-auto">
			<h1>Informed Consent Form</h1>
			<p>
				Study Title: AI for Supporting Independent Writing Researchers:
				Kenneth C. Arnold, Ph.D., Jooha (Hannah) Yoo, Alina Sainju, Jiho
				Kim
			</p>
			<ol type="1">
				<li>Introduction</li>
			</ol>
			<p>
				We invite you to participate in a study exploring the design of
				AI writing assistants. Participation in the study is entirely
				voluntary. If you have any questions or concerns, please feel
				free to discuss them with the primary investigator, Kenneth C.
				Arnold, Ph.D. (see Section 10). If you decide to take part, you
				will sign this form to signify your consent to participate in
				the study as outlined below. A copy of the form will be given to
				you for your record.
			</p>
			<ol start={2} type="1">
				<li>Purpose of the Study</li>
			</ol>
			<p>
				The purpose of this study is to investigate how AI systems might
				facilitate independent writing.
			</p>
			<ol start={3} type="1">
				<li>Procedures</li>
			</ol>
			<p>
				Your participation entails performing a writing task using a
				system that offers AI-generated suggestions. There will also be
				surveys and a semi-guided interview with the researchers. The
				study itself will be conducted via a Microsoft Teams meeting,
				which will be used to record your screen, record audio, and
				generate automatic audio transcripts. Please see Section 7 for
				more detail on how your data will be handled. At the end of the
				session, you can save a copy of your work for personal use.
				Please note, however, that (1) if you publish it publicly,
				someone may be able to identify you by comparing the text with
				excerpts from your study session that are used in academic
				publications, and (2) your writing may be considered
				“AI-assisted”, which may preclude certain uses such as
				submitting it for class assignments.
			</p>
			<ol start={4} type="1">
				<li>Time Duration</li>
			</ol>
			<p>Participating in this study will take about 60 minutes.</p>
			<ol start={5} type="1">
				<li>Discomforts and Risks</li>
			</ol>
			<p>
				We do not anticipate any discomforts or risks from participating
				in this study.
			</p>
			<ol start={6} type="1">
				<li>Potential Benefits</li>
			</ol>
			<p>
				Your participation in this study may benefit future users of our
				software and contribute to scientific knowledge about how AI can
				influence the process of writing.
			</p>
			<ol start={7} type="1">
				<li>Statement of Confidentiality</li>
			</ol>
			<p>
				We will be collecting several types of data from your
				participation in this study, including records of how you
				interact with the AI writing tool, samples of your writing,
				screen and audio recordings, and automatic audio transcripts.
				Selections from your writing, along with AI-generated outputs,
				will be collected as log data and stored on secure computers
				that are accessible only to our research team. Upon completion
				of the study, you will have the option to allow us to use your
				logged data for training and improving our AI systems. If you do
				not opt-in, your data will be deleted at the conclusion of this
				research.
			</p>
			<p>
				Portions of your writing will be sent to third-party service
				providers such as OpenAI, Google, or Anthropic to request text
				from their AI services. We require that service providers
				guarantee confidentiality of the data sent to them and that they
				promise not to use that data to train their AI models or
				otherwise improve their services.
			</p>
			<p>
				The writing samples you provide, the screen and audio
				recordings, and the automatic audio transcripts will be stored
				in a secure storage location on Microsoft cloud services
				including SharePoint, and additionally on a qualitative analysis
				tool such as Delve. These platforms enable our research team to
				safely store, organize, share, and access the data in a private
				and collaborative environment, accessible only to the
				investigators. Once the study is complete, we will take steps to
				ensure the permanent deletion of recordings and transcripts.
				Your data will be stored in password-protected files and
				services accessible only to the researchers. In the unlikely
				event of a technical problem with the files, the researchers may
				grant software technical support staff temporary access to the
				files. In such cases, technical support staff will access the
				files solely to resolve the technical problem. Once issues are
				resolved, the researchers will revoke the technical support
				staff’s access to the files.
			</p>
			<p>
				Results of this study will be shared in academic publications
				and presentations. These results may include quotes from
				participants and samples of the system’s input and output, but
				we will ensure that quotes do not identify you.
			</p>
			<ol start={8} type="1">
				<li>Compensation for Participation</li>
			</ol>
			<p>
				Participants will receive $10 compensation for their time
				completing this study.
			</p>
			<ol start={9} type="1">
				<li>Voluntary Participation</li>
			</ol>
			<p>
				Your participation is entirely voluntary. You may decline to
				participate without penalty, withdraw at any time without
				penalty, request deletion of your data, and choose whether to
				retain copies of your work.
			</p>
			<ol start={10} type="1">
				<li>Contact Information of the Primary Investigator</li>
			</ol>
			<p>
				If you have questions about this research or if you think you
				have been harmed by participating, you may contact Professor
				Kenneth C. Arnold, Department of Computer Science, Calvin
				University, by email at ken.arnold@calvin.edu, by phone at
				616-526-8723, or by mail at 3201 Burton St SE, Grand Rapids, MI
				49546.
			</p>
			<ol start={11} type="1">
				<li>Institutional Review Board Approval</li>
			</ol>
			<p>
				The Calvin University Institutional Review Board has approved
				this study. If you have questions about your rights as a
				research participant, or wish to obtain information, ask
				questions or discuss any concerns about this study with someone
				other than the researcher(s), please contact the Calvin
				University Institutional Review Board Committee at Office of the
				Provost, Calvin University, 3201 Burton St SE, Grand Rapids, MI
				49546, irb@calvin.edu.
			</p>
			<ol start={12} type="1">
				<li>Written Consent</li>
			</ol>
			<p>
				By clicking the button below, I am giving my informed consent to
				participate in the study described above. I understand that my
				participation is voluntary, and I am free to withdraw at any
				time, without any reason, and without any penalty or loss of
				benefits to which I am otherwise entitled.
			</p>
			<button type="button" onClick={onConsent} className="bg-blue-500 text-white py-2 px-4 rounded cursor-pointer">
				I Consent
			</button>
		</div>
	);
}
